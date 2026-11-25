// Runs in the `app` project: every way a single sign-on callback must fail to tie to its browser, its provider and its
// flow, one case each, against the built Worker. A refusal leaves no session and no cookie behind.
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MockIdp, MockLogin } from '../../test/helpers/mock-idp';
import {
  attempt,
  callback,
  idpForConfigured,
  LOGIN,
  linked,
  nowSeconds,
  refused,
  someone,
  start,
} from '../../test/helpers/sso';
import { expireFlow } from '../db/test-support-sso';
import { currentEnv } from '../lib/env';
import { keyedHash } from './tokens';

let idp: MockIdp;
beforeEach(async () => {
  idp = await idpForConfigured();
});
afterEach(() => {
  idp.restore();
});

const { SESSION_SECRET } = currentEnv();

describe('SEC-40 the callback refuses what it cannot tie to the browser that began it', () => {
  it('a state that is not the flow cookie, and no flow cookie at all, both fail', async () => {
    await linked('c1');
    refused(await attempt(idp, { subject: 'c1' }, (u) => [u, 'another-flow-cookie']), 400);
    refused(await attempt(idp, { subject: 'c1' }, (u) => [u, null]), 400);
    refused(
      await attempt(idp, { subject: 'c1' }, (u, f) => [u.replace('state=', 'state=x'), f]),
      400,
    );
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
    await expireFlow(env.DB, hash);
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
    refused(await attempt(idp, login(await someone())), 400);
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
