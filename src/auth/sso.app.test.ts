// Runs in the `app` project: the /auth/sso routes through the built Worker, with an in-process identity provider
// (`test/helpers/mock-idp.ts`) answering discovery and the token endpoint.
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addPerson, adminScope, MINUTE, storedFor } from '../../test/helpers/auth';
import { caller, getPage } from '../../test/helpers/callers';
import type { MockIdp } from '../../test/helpers/mock-idp';
import { eventsAfter, headSeq } from '../../test/helpers/reference';
import {
  callback,
  get,
  idpForConfigured,
  link,
  provider,
  setCookie,
  signedInAs,
  start,
  through,
} from '../../test/helpers/sso';
import { storedRows } from '../db/stored-rows';
import { currentEnv } from '../lib/env';
import { issueEnrolment } from './enrol';
import { newSession, SESSION_COOKIE } from './session';
import { SSO_COOKIE } from './sso';

let idp: MockIdp;
beforeEach(async () => {
  idp = await idpForConfigured();
});
afterEach(() => {
  idp.restore();
});

const { SESSION_SECRET, ORIGIN } = currentEnv();
const A = (): string => provider('tenant-a').issuer;

/** A person with an open enrolment link. */
async function invited(): Promise<{ id: string; token: string }> {
  const person = await addPerson();
  const token = await issueEnrolment(
    await adminScope(),
    env.DB,
    SESSION_SECRET,
    person.id,
    Date.now(),
  );
  return { id: person.id, token };
}

const handoffTo = (body: string): string | null =>
  /<meta http-equiv="refresh" content="0;url=([^"]*)">/.exec(body)?.[1] ?? null;

describe('SEC-38 signing in through an identity provider', () => {
  it('an enrolment link binds an identity, opens a session, audits it, and the next sign-in finds it', async () => {
    const { id, token } = await invited();
    const seq = await headSeq();
    const begun = await start(`/auth/sso/enrol?provider=tenant-a&token=${token}`);
    expect(begun.response.status).toBe(302);
    expect(begun.location).toMatch(/^https:\/\/idp-a\.example\/a\/v2\.0\/authorize\?/);
    expect(new URL(begun.location).searchParams.get('prompt')).toBe('select_account');
    const cookie = begun.response.headers.getSetCookie().find((c) => c.startsWith(SSO_COOKIE));
    expect(cookie).toMatch(/Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/);

    const done = await callback(
      idp.authorize(begun.location, { subject: 's1', email: 'a@x.example' }),
      begun.flow,
    );
    expect(done.status).toBe(200);
    expect(handoffTo(await done.text())).toBe('/week');
    const sessionLine = done.headers.getSetCookie().find((c) => c.startsWith(SESSION_COOKIE));
    expect(sessionLine).toMatch(/SameSite=Strict/);
    expect(setCookie(done, SSO_COOKIE)).toBe('');
    expect((await getPage('/account', signedInAs(done, id))).status).toBe(200);
    expect(await storedFor('person_identity', id)).toMatchObject([
      { provider: 'tenant-a', issuer: A(), subject: 's1', email: 'a@x.example', revoked_at: null },
    ]);
    const events = (await eventsAfter(seq)).filter((e) => e.target === `person:${id}`);
    expect(events.map((e) => e.action)).toEqual(['auth.enrol']);
    expect(JSON.parse(events[0]?.after_json ?? '{}')).toEqual({
      method: 'sso',
      provider: 'tenant-a',
    });
    expect(events[0]?.actor_id).toBe(id);

    const again = await through(idp, '/auth/sso/login?provider=tenant-a', { subject: 's1' });
    expect(again.status).toBe(200);
    expect((await getPage('/account', signedInAs(again, id))).status).toBe(200);
    expect((await storedFor('person_identity', id))[0]?.last_used_at).toEqual(expect.any(Number));
    expect((await eventsAfter(seq)).filter((e) => e.action === 'auth.enrol')).toHaveLength(1);
  });

  it('the request carries state, a nonce and an S256 challenge, and the code is traded with the secret and the verifier', async () => {
    const begun = await start('/auth/sso/login?provider=tenant-b');
    const q = new URL(begun.location).searchParams;
    expect(Object.fromEntries(q)).toMatchObject({
      client_id: 'client-b',
      redirect_uri: `${ORIGIN}/auth/sso/callback`,
      response_type: 'code',
      response_mode: 'query',
      scope: 'openid email profile',
      code_challenge_method: 'S256',
      state: begun.flow,
    });
    expect(q.get('nonce')).toMatch(/.{20}/);
    expect(q.get('code_challenge')).toMatch(/.{40}/);
    expect(q.has('max_age') || q.has('prompt')).toBe(false);
    await link((await addPerson()).id, 'tenant-b', 's2');
    await callback(idp.authorize(begun.location, { subject: 's2' }), begun.flow);
    const [token] = idp.tokenRequests;
    expect(token?.authorization).toMatch(/^Basic /);
    expect(token?.params.get('code_verifier')).toMatch(/.{40}/);
    expect(token?.params.get('redirect_uri')).toBe(`${ORIGIN}/auth/sso/callback`);
  });

  it('stores the flow only as a hash, with its verifier, for ten minutes, and uses it once', async () => {
    const begun = await start('/auth/sso/login?provider=tenant-a');
    const rows = await storedRows(env.DB, 'oidc_flow');
    expect(JSON.stringify(rows)).not.toContain(begun.flow ?? 'x');
    const mine = rows.at(-1);
    expect(mine).toMatchObject({ provider: 'tenant-a', purpose: 'login', used_at: null });
    expect(Number(mine?.expires_at) - Number(mine?.created_at)).toBe(10 * MINUTE);
  });

  it('keeps one tenant’s account apart from another’s, and only a same-origin path as the way on', async () => {
    const who = await addPerson();
    await link(who.id, 'tenant-a', 'shared-sub');
    const other = await through(idp, '/auth/sso/login?provider=tenant-b', {
      subject: 'shared-sub',
    });
    expect(other.status).toBe(403);
    for (const bad of [
      '//evil.example/x',
      'https://evil.example/x',
      '/\\evil.example',
      'javascript:alert(1)',
      '/a b',
    ]) {
      const done = await through(
        idp,
        `/auth/sso/login?provider=tenant-a&return=${encodeURIComponent(bad)}`,
        {
          subject: 'shared-sub',
        },
      );
      expect(handoffTo(await done.text()), bad).toBe('/week');
    }
    const good = await through(idp, '/auth/sso/login?provider=tenant-a&return=%2Faccount', {
      subject: 'shared-sub',
    });
    expect(handoffTo(await good.text())).toBe('/account');
  });

  it('Google signs in only a Workspace account of the configured domain', async () => {
    const who = await addPerson();
    await link(who.id, 'google', 'g1');
    const wrong = await through(idp, '/auth/sso/login?provider=google', {
      subject: 'g1',
      claims: { hd: 'other.example' },
    });
    expect(wrong.status).toBe(400);
    const none = await through(idp, '/auth/sso/login?provider=google', { subject: 'g1' });
    expect(none.status).toBe(400);
    const right = await through(idp, '/auth/sso/login?provider=google', {
      subject: 'g1',
      claims: { hd: 'practice.example' },
    });
    expect(right.status).toBe(200);
  });
});

describe('SEC-38 another site cannot start an enrolment', () => {
  it('a start from a cross-site or same-site navigation is refused, and one from this origin goes on', async () => {
    const { token } = await invited();
    const path = `/auth/sso/enrol?provider=tenant-a&token=${token}`;
    for (const site of ['cross-site', 'same-site']) {
      const response = await get(path, [], { 'sec-fetch-site': site });
      expect(response.status).toBe(400);
      expect(setCookie(response, SSO_COOKIE)).toBe('');
    }
    expect((await get(path, [], { 'sec-fetch-site': 'same-origin' })).status).toBe(302);
  });
});

describe('SEC-39 confirming again through the identity provider', () => {
  it('asks the provider to authenticate again and stamps only the session that asked, from a fresh auth_time', async () => {
    const who = await caller([], { stepUpAgo: 20 * MINUTE });
    await link(who.personId, 'tenant-a', 'step-1');
    const other = await newSession(env.DB, SESSION_SECRET, who.personId, Date.now() - 20 * MINUTE);
    await other.statement.run();
    const heldBefore = (await storedFor('session', who.personId)).map((row) => row.step_up_at);
    const begun = await start('/auth/sso/step-up?provider=tenant-a&return=%2Faccount', who);
    const q = new URL(begun.location).searchParams;
    expect([q.get('max_age'), q.get('prompt')]).toEqual(['0', 'login']);
    const done = await callback(idp.authorize(begun.location, { subject: 'step-1' }), begun.flow);
    expect(done.status).toBe(200);
    expect(handoffTo(await done.text())).toBe('/account');
    expect(setCookie(done, SESSION_COOKIE)).toBeNull();
    const after = await storedFor('session', who.personId);
    expect(after).toHaveLength(2);
    const moved = after.filter((row, i) => row.step_up_at !== heldBefore[i]);
    expect(moved).toHaveLength(1);
    expect((moved[0]?.step_up_at as number) > Math.max(...(heldBefore as number[]))).toBe(true);
  });

  it('is refused for a person with no identity at that provider, and for no session at all', async () => {
    const who = await caller();
    expect((await start('/auth/sso/step-up?provider=tenant-a', who)).response.status).toBe(403);
    expect((await start('/auth/sso/step-up?provider=tenant-a')).response.status).toBe(303);
  });
});
