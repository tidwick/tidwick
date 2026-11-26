// The token endpoint: a code or a refresh token in, an access token and a rotated refresh token out. Every failure
// after a token is found is `invalid_grant`, and a spent token shown again cuts the grant it belonged to, since
// only a copy can be shown twice.
import { keyedHash, randomToken, sameText, toBase64Url } from '../auth/tokens';
import { insertToken } from '../db/agent-grants';
import {
  activateGrant,
  liveGrant,
  pruneTokens,
  revokeGrantById,
  spendToken,
  spentFor,
  type OauthGrant,
} from '../db/agent-oauth';
import { auditedBatch, retryOnce } from '../db/audit';
import { agentScopeFor } from '../db/scope';
import type { Env } from '../lib/env';
import { audience, one, scopesAsked } from './authorize';
import { OauthError } from './error';

export const ACCESS_MS = 60 * 60 * 1000;
export const REFRESH_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
export const ABSOLUTE_MS = 90 * 24 * 60 * 60 * 1000;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

const gone = (): OauthError =>
  new OauthError('invalid_grant', 'The code or refresh token is not valid.');

function field(form: URLSearchParams, name: string): string {
  const value = one(form, name);
  if (value === null || value === '')
    throw new OauthError('invalid_request', `The parameter ${name} is missing.`);
  return value;
}

/** Cuts the grant a spent token belonged to, audited as the agent's own revoke; a grant already gone is left. */
async function cutGrant(env: Env, grantId: string, now: number): Promise<void> {
  const grant = await liveGrant(env.DB, grantId, now);
  if (grant === null) return;
  const scope = await agentScopeFor(env.DB, grant).catch(() => null);
  if (scope === null) {
    await revokeGrantById(env.DB, grantId, now).run();
    return;
  }
  await retryOnce(async () => {
    const batch = await auditedBatch(scope, env.DB);
    await batch.record(
      revokeGrantById(env.DB, grantId, now),
      {
        at: now,
        action: 'agents.revoke',
        clientId: null,
        target: `person:${grant.person_id}`,
        before: { grants: [grantId], reason: 'a spent token was presented again' },
      },
      1,
    );
    await batch.run();
  });
}

/** A spent code or refresh token's grant, or `invalid_grant` after cutting the grant when the token was seen before. */
async function spend(
  env: Env,
  token: string,
  kind: 'code' | 'refresh',
  now: number,
): Promise<{ grant: OauthGrant; challenge: string | null }> {
  const hash = await keyedHash(
    env.SESSION_SECRET,
    kind === 'code' ? 'agent_code' : 'agent_refresh',
    token,
  );
  const spent = await spendToken(env.DB, hash, kind, now);
  if (spent === null) {
    const before = await spentFor(env.DB, hash, kind);
    if (before !== null) await cutGrant(env, before, now);
    throw gone();
  }
  const grant = await liveGrant(env.DB, spent.grant_id, now);
  if (grant === null) throw gone();
  return { grant, challenge: spent.challenge };
}

async function pkceHolds(verifier: string, challenge: string | null): Promise<boolean> {
  if (challenge === null || !VERIFIER.test(verifier)) return false;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return sameText(toBase64Url(new Uint8Array(digest)), challenge);
}

/** Issues the pair of tokens for a grant; a first issue (from a code) also gives the grant its 90-day end. */
async function issue(
  env: Env,
  grant: OauthGrant,
  first: boolean,
  now: number,
): Promise<TokenResponse> {
  const access = randomToken();
  const refresh = randomToken();
  const absolute = grant.created_at + ABSOLUTE_MS;
  const statements = [
    insertToken(env.DB, {
      hash: await keyedHash(env.SESSION_SECRET, 'agent_access', access),
      grantId: grant.id,
      kind: 'access',
      expiresAt: Math.min(now + ACCESS_MS, absolute),
    }),
    insertToken(env.DB, {
      hash: await keyedHash(env.SESSION_SECRET, 'agent_refresh', refresh),
      grantId: grant.id,
      kind: 'refresh',
      expiresAt: Math.min(now + REFRESH_IDLE_MS, absolute),
    }),
    pruneTokens(env.DB, grant.id, now),
  ];
  if (first) statements.push(activateGrant(env.DB, grant.id, ABSOLUTE_MS));
  await env.DB.batch(statements);
  const scopes = JSON.parse(grant.scopes) as string[];
  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: Math.min(ACCESS_MS, absolute - now) / 1000,
    refresh_token: refresh,
    scope: scopes.join(' '),
  };
}

/** Answers one token request, already read as a form. Throws `OauthError` for the client to see. */
export async function exchange(
  env: Env,
  form: URLSearchParams,
  now: number,
): Promise<TokenResponse> {
  const resource = one(form, 'resource');
  if (resource !== null && resource !== audience(env.ORIGIN))
    throw new OauthError('invalid_target', 'The resource is not this server’s /mcp.');
  const type = one(form, 'grant_type');
  if (type === 'authorization_code') {
    const verifier = field(form, 'code_verifier');
    const redirect = field(form, 'redirect_uri');
    const client = field(form, 'client_id');
    const { grant, challenge } = await spend(env, field(form, 'code'), 'code', now);
    if (
      grant.client_id !== client ||
      grant.redirect_uri !== redirect ||
      !(await pkceHolds(verifier, challenge))
    )
      throw gone();
    return issue(env, grant, true, now);
  }
  if (type === 'refresh_token') {
    const client = field(form, 'client_id');
    const asked = scopesAsked(one(form, 'scope'));
    const { grant } = await spend(env, field(form, 'refresh_token'), 'refresh', now);
    const held = JSON.parse(grant.scopes) as string[];
    if (grant.client_id !== client) throw gone();
    if (asked.some((s) => !held.includes(s)))
      throw new OauthError('invalid_scope', 'The scope is wider than the grant.');
    return issue(env, grant, false, now);
  }
  throw new OauthError('unsupported_grant_type', 'Use authorization_code or refresh_token.');
}
