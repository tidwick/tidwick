// Single sign-on by OpenID Connect (ADR 0003): three ways to start (sign in, enrol, step up), one callback that
// finishes any of them. A flow is a one-time row named by `state`, which the browser also carries in a Lax cookie
// (the session cookie is Strict and is not sent when the provider redirects back). No IdP token is kept, and an
// identity is the issuer and subject, never an email. The protocol is src/auth/sso-oidc.ts's.
import { auditedBatch, retryWhileOpen } from '../db/audit';
import {
  identityOfSubject,
  insertIdentity,
  liveIdentitiesOf,
  useIdentity,
  type SubjectIdentity,
} from '../db/identities';
import { openEnrolment, openEnrolmentCount, useEnrolment } from '../db/enrolments';
import { claimFlow, insertFlow, type FlowRow } from '../db/oidc-flows';
import { ceremonyScope } from '../db/scope';
import { liveSession, revokeSession, stepUpSession } from '../db/sessions';
import { newId } from '../lib/ids';
import type { Env } from '../lib/env';
import { fail } from '../lib/errors';
import type { SsoProvider } from '../lib/sso-config';
import { recordClosedLinks } from './enrol';
import { IDLE_MS, hostCookie, newSession, type Session } from './session';
import { authorizationUrl, discover, exchange, type Claims } from './sso-oidc';
import { keyedHash, randomToken, sameText } from './tokens';
import * as oauth from 'oauth4webapi';

export const SSO_COOKIE = '__Host-tidwick-sso';
export const FLOW_MS = 10 * 60 * 1000;
/** How far before the flow began a provider's `auth_time` may sit and still count as signing in for it. */
const SKEW_S = 30;
const DEFAULT_RETURN = '/week';
const SAFE_PATH = /^\/(?![/\\])[\x21-\x7e]{0,199}$/;

export const ssoCookie = (rawId: string): string =>
  hostCookie(SSO_COOKIE, rawId, FLOW_MS / 1000, 'Lax');
export const clearedSsoCookie = (): string => hostCookie(SSO_COOKIE, '', 0, 'Lax');

/** The provider named by `?provider=`; none configured, or none by that id, is a route that is not there. */
export function providerOf(env: Env, id: string | null): SsoProvider {
  return env.SSO.find((p) => p.id === id) ?? fail('not_found');
}

/** A same-origin path (one `/`, printable ASCII), or the default: never an absolute URL, `//host` or `/\host`. */
export function safeReturn(value: string | null, fallback = DEFAULT_RETURN): string {
  return value !== null && SAFE_PATH.test(value) ? value : fallback;
}

export type FlowStart =
  | { purpose: 'login'; provider: SsoProvider; returnTo: string }
  | { purpose: 'enrol'; provider: SsoProvider; returnTo: string; token: string }
  | { purpose: 'step_up'; provider: SsoProvider; returnTo: string; session: Session };

/** What each purpose carries into its flow row: the person it names, and the link or session it will act on. */
async function bound(env: Env, start: FlowStart, now: number) {
  const none = { personId: null, sessionHash: null, enrolHash: null };
  if (start.purpose === 'login') return none;
  if (start.purpose === 'enrol') {
    const enrolHash = await keyedHash(env.SESSION_SECRET, 'enrol', start.token);
    const link = await openEnrolment(env.DB, enrolHash, now);
    if (!link) fail('enrolment_invalid');
    return { ...none, personId: link.person_id, enrolHash };
  }
  const held = await liveIdentitiesOf(env.DB, start.session.personId);
  if (!held.some((identity) => identity.issuer === start.provider.issuer)) fail('sso_unlinked');
  const sessionHash = await keyedHash(env.SESSION_SECRET, 'session', start.session.rawId);
  return { ...none, personId: start.session.personId, sessionHash };
}

/** Stores the flow and returns the provider's address to send the browser to, with the flow cookie to set. */
export async function startFlow(
  env: Env,
  start: FlowStart,
  now: number,
): Promise<{ location: string; cookie: string }> {
  const server = await discover(start.provider, now);
  const rows = await bound(env, start, now);
  const state = randomToken();
  const verifier = oauth.generateRandomCodeVerifier();
  const nonce = oauth.generateRandomNonce();
  await insertFlow(
    env.DB,
    {
      idHash: await keyedHash(env.SESSION_SECRET, 'sso_flow', state),
      provider: start.provider.id,
      purpose: start.purpose,
      person_id: rows.personId,
      session_hash: rows.sessionHash,
      enrol_hash: rows.enrolHash,
      verifier,
      nonce,
      return_to: start.returnTo,
      expiresAt: now + FLOW_MS,
    },
    now,
  );
  const location = await authorizationUrl(start.provider, server, {
    redirectUri: redirectUri(env),
    state,
    nonce,
    verifier,
    fresh: start.purpose === 'step_up',
  });
  return { location, cookie: ssoCookie(state) };
}

const redirectUri = (env: Env): string => `${env.ORIGIN}/auth/sso/callback`;

/** An identity cannot be linked to two people, nor a person to two accounts at one issuer. */
async function refuseTaken(env: Env, provider: SsoProvider, claims: Claims, personId: string) {
  if (await identityOfSubject(env.DB, provider.issuer, claims.subject)) fail('sso_taken');
  const held = await liveIdentitiesOf(env.DB, personId);
  if (held.some((identity) => identity.issuer === provider.issuer)) fail('sso_taken');
}

/** Links the identity, uses the link, closes the person's others, audits and opens a session, in one batch. */
async function enrol(env: Env, provider: SsoProvider, claims: Claims, flow: FlowRow, now: number) {
  const { DB: db } = env;
  const { person_id: personId, enrol_hash: tokenHash } = flow;
  if (personId === null || tokenHash === null) fail('sso_failed');
  const session = await newSession(db, env.SESSION_SECRET, personId, now);
  const stillOpen = async () => (await openEnrolment(db, tokenHash, now))?.person_id === personId;
  await retryWhileOpen(
    async () => {
      if (!(await stillOpen())) fail('enrolment_invalid');
      await refuseTaken(env, provider, claims, personId);
      const others = (await openEnrolmentCount(db, personId, now)) - 1;
      const batch = await auditedBatch(ceremonyScope(personId), db);
      await batch.record(
        useEnrolment(db, tokenHash, personId, now),
        {
          at: now,
          action: 'auth.enrol',
          clientId: null,
          target: `person:${personId}`,
          after: { method: 'sso', provider: provider.id },
        },
        1,
      );
      await recordClosedLinks(batch, db, personId, now, others);
      const identity = {
        id: newId(),
        personId,
        provider: provider.id,
        issuer: provider.issuer,
        subject: claims.subject,
        email: claims.email,
      };
      batch.also(insertIdentity(db, identity, now));
      batch.also(session.statement);
      await batch.run();
    },
    stillOpen,
    () => fail('enrolment_invalid'),
  );
  return session.rawId;
}

/** Opens a session for the person whose live identity this is; an unlinked or offboarded one is `sso_unlinked`. */
async function signIn(env: Env, provider: SsoProvider, claims: Claims, now: number) {
  const { DB: db, SESSION_SECRET: secret } = env;
  const found = await identityOfSubject(db, provider.issuer, claims.subject);
  if (!found || found.offboarded_at !== null) fail('sso_unlinked');
  const session = await newSession(db, secret, found.person_id, now);
  const [used] = await db.batch([useIdentity(db, found.id, now), session.statement]);
  if (used?.meta.changes !== 1) {
    await revokeSession(db, await keyedHash(secret, 'session', session.rawId), now).run();
    fail('sso_unlinked');
  }
  return session.rawId;
}

/** Stamps the starting session as stepped up, if the provider says the person signed in again since the flow began. */
async function stepUp(env: Env, provider: SsoProvider, claims: Claims, flow: FlowRow, now: number) {
  const { DB: db } = env;
  const { person_id: personId, session_hash: sessionHash } = flow;
  if (personId === null || sessionHash === null) fail('sso_failed');
  const found: SubjectIdentity | null = await identityOfSubject(
    db,
    provider.issuer,
    claims.subject,
  );
  if (found?.person_id !== personId) fail('sso_failed');
  if (claims.authTime === null || claims.authTime < flow.created_at / 1000 - SKEW_S)
    fail('step_up_required');
  const session = await liveSession(db, sessionHash);
  const alive = session?.person_id === personId && session.offboarded_at === null;
  if (!session || !alive || now >= session.expires_at || now - session.seen_at >= IDLE_MS)
    fail('sso_failed');
  const [stamped] = await db.batch([
    stepUpSession(db, sessionHash, now),
    useIdentity(db, found.id, now),
  ]);
  if (stamped?.meta.changes !== 1) fail('sso_failed');
}

/**
 * Finishes the flow a provider's redirect names: `state` must equal the flow cookie and name a flow that is unused
 * and under ten minutes old, which it claims. Returns the new session id for a sign-in or an enrolment, null for a
 * step-up, and the path to hand the browser on to. Every refusal is a catalog error.
 */
export async function finishFlow(
  env: Env,
  cookie: string | null,
  callback: URL,
  now: number,
): Promise<{ sessionId: string | null; returnTo: string }> {
  const state = callback.searchParams.get('state');
  if (cookie === null || state === null || !sameText(cookie, state)) fail('sso_failed');
  const flow = await claimFlow(env.DB, await keyedHash(env.SESSION_SECRET, 'sso_flow', state), now);
  if (!flow) fail('sso_failed');
  const provider = env.SSO.find((p) => p.id === flow.provider) ?? fail('sso_failed');
  const server = await discover(provider, now);
  const claims = await exchange(provider, server, callback.searchParams, {
    redirectUri: redirectUri(env),
    state,
    nonce: flow.nonce,
    verifier: flow.verifier,
  });
  const returnTo = safeReturn(flow.return_to);
  if (flow.purpose === 'login')
    return { sessionId: await signIn(env, provider, claims, now), returnTo };
  if (flow.purpose === 'enrol')
    return { sessionId: await enrol(env, provider, claims, flow, now), returnTo };
  if (flow.purpose === 'step_up') {
    await stepUp(env, provider, claims, flow, now);
    return { sessionId: null, returnTo };
  }
  return fail('sso_failed');
}
