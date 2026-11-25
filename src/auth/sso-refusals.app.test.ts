// Runs in the `app` project: every way a single sign-on callback must fail, one case each, against the built Worker.
// A refusal leaves no session, no identity and no stamped step-up behind.
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addPerson, adminScope, storedFor } from '../../test/helpers/auth';
import { caller } from '../../test/helpers/callers';
import type { MockIdp, MockLogin } from '../../test/helpers/mock-idp';
import {
  callback,
  idpForConfigured,
  link,
  provider,
  setCookie,
  start,
  through,
} from '../../test/helpers/sso';
import { currentEnv } from '../lib/env';
import { issueEnrolment } from './enrol';
import { SESSION_COOKIE } from './session';
import { SSO_COOKIE } from './sso';
import { keyedHash } from './tokens';

let idp: MockIdp;
beforeEach(async () => {
  idp = await idpForConfigured();
});
afterEach(() => {
  idp.restore();
});

const { SESSION_SECRET } = currentEnv();
const nowSeconds = (): number => Math.floor(Date.now() / 1000);
const LOGIN = '/auth/sso/login?provider=tenant-a';

/** A person already linked at tenant A as `subject`. */
async function linked(subject: string): Promise<string> {
  const { id } = await addPerson();
  await link(id, 'tenant-a', subject);
  return id;
}

let serial = 0;
/** A subject no other case has used, linked to a new person. */
async function someone(): Promise<string> {
  const subject = `subject-${String((serial += 1))}`;
  await linked(subject);
  return subject;
}

/** The callback for a login as `login`, after `tamper` has changed the address or the cookie the browser sends. */
async function attempt(
  login: MockLogin,
  tamper: (url: string, flow: string | null) => [string, string | null] = (u, f) => [u, f],
  path = LOGIN,
): Promise<Response> {
  const begun = await start(path);
  const [url, flow] = tamper(idp.authorize(begun.location, login), begun.flow);
  return callback(url, flow);
}

/** What a refusal must never have done. */
function refused(response: Response, status: number): void {
  expect(response.status).toBe(status);
  expect(setCookie(response, SESSION_COOKIE)).toBeNull();
  expect(setCookie(response, SSO_COOKIE)).toBe('');
}

describe('SEC-40 the callback refuses what it cannot tie to the browser that began it', () => {
  it('a state that is not the flow cookie, and no flow cookie at all, both fail', async () => {
    await linked('c1');
    refused(await attempt({ subject: 'c1' }, (u) => [u, 'another-flow-cookie']), 400);
    refused(await attempt({ subject: 'c1' }, (u) => [u, null]), 400);
    refused(await attempt({ subject: 'c1' }, (u, f) => [u.replace('state=', 'state=x'), f]), 400);
  });

  it('a callback another browser began fails here: its code and state arrive without the cookie', async () => {
    await linked('c2');
    const theirs = await start(LOGIN);
    const stolen = idp.authorize(theirs.location, { subject: 'c2' });
    refused(await callback(stolen, null), 400);
    const mine = await start(LOGIN);
    refused(await callback(stolen, mine.flow), 400);
  });

  it('a flow works once, and not after ten minutes', async () => {
    await linked('c3');
    const begun = await start(LOGIN);
    const back = idp.authorize(begun.location, { subject: 'c3' });
    expect((await callback(back, begun.flow)).status).toBe(200);
    refused(await callback(back, begun.flow), 400);
    const old = await start(LOGIN);
    const hash = await keyedHash(SESSION_SECRET, 'sso_flow', old.flow ?? '');
    await env.DB.prepare('UPDATE oidc_flow SET expires_at = 1 WHERE id_hash = ?1').bind(hash).run();
    refused(await callback(idp.authorize(old.location, { subject: 'c3' }), old.flow), 400);
  });

  it('an error from the provider fails', async () => {
    const begun = await start(LOGIN);
    const url = `${new URL(idp.authorize(begun.location, { subject: 'x' })).origin}/auth/sso/callback`;
    refused(
      await callback(`${url}?error=access_denied&state=${begun.flow ?? ''}`, begun.flow),
      400,
    );
  });
});

describe('SEC-41 the ID token must be for this provider, this client and this flow', () => {
  /** Each case, and whether it gets as far as the token endpoint: an `iss` that is wrong is refused before the code is traded. */
  const cases: [string, (subject: string) => MockLogin, number][] = [
    [
      'a nonce that is not the flow’s',
      (subject) => ({ subject, claims: { nonce: 'another-nonce' } }),
      1,
    ],
    ['no nonce', (subject) => ({ subject, claims: { nonce: undefined } }), 1],
    [
      'an iss parameter for another provider',
      (subject) => ({ subject, redirect: { iss: 'https://idp-b.example/b/v2.0' } }),
      0,
    ],
    [
      'an issuer claim for another provider',
      (subject) => ({ subject, claims: { iss: 'https://idp-b.example/b/v2.0' } }),
      1,
    ],
    [
      'an audience that is another client',
      (subject) => ({ subject, claims: { aud: 'client-b' } }),
      1,
    ],
    [
      'an authorized party that is another client',
      (subject) => ({ subject, claims: { aud: ['client-a', 'client-b'], azp: 'client-b' } }),
      1,
    ],
    ['an expired token', (subject) => ({ subject, claims: { exp: nowSeconds() - 3600 } }), 1],
  ];

  it.each(cases)('a token with %s fails', async (_name, login, traded) => {
    const before = idp.tokenRequests.length;
    refused(await attempt(login(await someone())), 400);
    expect(idp.tokenRequests.length - before).toBe(traded);
  });

  it('a code another provider issued fails at this flow’s token endpoint', async () => {
    const subject = await someone();
    const a = await start(LOGIN);
    const b = await start('/auth/sso/login?provider=tenant-b');
    const forB = idp.authorize(b.location, { subject });
    const mixed = forB.replace(/state=[^&]*/, `state=${a.flow ?? ''}`);
    refused(await callback(mixed, a.flow), 400);
  });

  it('a provider that is down, or whose metadata names another issuer, is unavailable for itself alone', async () => {
    idp.down('https://idp-c.example/c/v2.0');
    expect((await start('/auth/sso/login?provider=tenant-c')).response.status).toBe(503);
    expect((await start(LOGIN)).response.status).toBe(302);
  });

  it('metadata that names a different issuer is refused, so a multi-tenant endpoint never matches', async () => {
    idp.misnamed('https://idp-c.example/c/v2.0');
    expect((await start('/auth/sso/login?provider=tenant-c')).response.status).toBe(503);
  });
});

describe('SEC-42 an identity is the issuer and subject, and only a person’s own link makes one', () => {
  it('an account no one linked is unlinked, even when its email is a person’s own', async () => {
    const who = await addPerson();
    refused(
      await attempt({ subject: 'nobody', email: who.email, claims: { email_verified: true } }),
      403,
    );
    expect(await storedFor('person_identity', who.id)).toEqual([]);
  });

  it('an offboarded person and a revoked identity both sign in as unlinked', async () => {
    const gone = await linked('o1');
    await env.DB.prepare('UPDATE person SET offboarded_at = 1 WHERE id = ?1').bind(gone).run();
    refused(await attempt({ subject: 'o1' }), 403);
    const revoked = await linked('o2');
    await env.DB.prepare('UPDATE person_identity SET revoked_at = 1 WHERE person_id = ?1')
      .bind(revoked)
      .run();
    refused(await attempt({ subject: 'o2' }), 403);
  });

  it('an enrolment link cannot take an account that is live for another person, or add a second at one issuer', async () => {
    await linked('t1');
    const first = await addPerson();
    const token = await issueEnrolment(
      await adminScope(),
      env.DB,
      SESSION_SECRET,
      first.id,
      Date.now(),
    );
    const path = `/auth/sso/enrol?provider=tenant-a&token=${token}`;
    refused(await attempt({ subject: 't1' }, undefined, path), 409);
    await link(first.id, 'tenant-a', 't2');
    refused(await attempt({ subject: 't3' }, undefined, path), 409);
    expect(await storedFor('person_identity', first.id)).toHaveLength(1);
  });

  it('an enrolment link works once, whichever way it is used', async () => {
    const who = await addPerson();
    const token = await issueEnrolment(
      await adminScope(),
      env.DB,
      SESSION_SECRET,
      who.id,
      Date.now(),
    );
    const path = `/auth/sso/enrol?provider=tenant-a&token=${token}`;
    const first = await start(path);
    const second = await start(path);
    expect(
      (await callback(idp.authorize(first.location, { subject: 'e1' }), first.flow)).status,
    ).toBe(200);
    refused(await callback(idp.authorize(second.location, { subject: 'e2' }), second.flow), 410);
    expect((await start(path)).response.status).toBe(410);
    expect(await storedFor('person_identity', who.id)).toHaveLength(1);
  });
});

describe('SEC-43 a step-up needs the provider to have authenticated the person again', () => {
  async function stepping() {
    const who = await caller([], { stepUpAgo: 30 * 60_000 });
    await link(who.personId, 'tenant-a', `step-${who.personId}`);
    return { who, subject: `step-${who.personId}` };
  }
  const stamp = async (id: string) => (await storedFor('session', id))[0]?.step_up_at;

  it.each([
    [
      'an auth_time before the flow began',
      (s: string): MockLogin => ({ subject: s, authTime: nowSeconds() - 3600 }),
    ],
    ['no auth_time', (s: string): MockLogin => ({ subject: s, authTime: null })],
  ])('%s leaves the session unconfirmed', async (_name, login) => {
    const { who, subject } = await stepping();
    const before = await stamp(who.personId);
    const begun = await start('/auth/sso/step-up?provider=tenant-a', who);
    const done = await callback(idp.authorize(begun.location, login(subject)), begun.flow);
    expect(done.status).toBe(403);
    expect(await stamp(who.personId)).toBe(before);
  });

  it('an identity that is another person’s leaves the session unconfirmed', async () => {
    const { who } = await stepping();
    await linked('someone-else');
    const before = await stamp(who.personId);
    const begun = await start('/auth/sso/step-up?provider=tenant-a', who);
    const done = await callback(
      idp.authorize(begun.location, { subject: 'someone-else' }),
      begun.flow,
    );
    expect(done.status).toBe(400);
    expect(await stamp(who.personId)).toBe(before);
  });

  it('a signed-in person can start no flow without their session: a cross-site start has no cookie', async () => {
    expect(
      (await through(idp, '/auth/sso/step-up?provider=tenant-a', { subject: 'x' })).status,
    ).toBe(401);
  });
});

describe('the start routes', () => {
  it('answer 404 for a provider that is not configured, or none', async () => {
    for (const path of [
      '/auth/sso/login',
      '/auth/sso/login?provider=nope',
      '/auth/sso/enrol?provider=nope&token=x',
    ]) {
      expect((await start(path)).response.status, path).toBe(404);
    }
    expect((await start('/auth/sso/enrol?provider=tenant-a')).response.status).toBe(410);
    expect(provider('tenant-a').id).toBe('tenant-a');
  });
});
