// Runs in the `app` project: a sign-in Action posted through the real middleware with a session cookie
// already set, as a fixation attacker would plant one.
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { addPerson, adminScope, deps, enrolledPerson } from '../../../test/helpers/auth';
import { caller, ORIGIN, rpcForm, type Caller } from '../../../test/helpers/callers';
import { createSoftwareAuthenticator } from '../../../test/helpers/software-authenticator';
import { CHALLENGE_COOKIE } from '../../auth/challenge';
import { addPasskeyOptions } from '../../auth/add-passkey';
import { enrolOptions, issueEnrolment } from '../../auth/enrol';
import { loginOptions } from '../../auth/login';
import { readSession, SESSION_COOKIE } from '../../auth/session';
import { DEFAULT_POLICY } from '../../lib/policy';

/** The session id a response sets, or null when it sets none. */
function setSession(response: Response): string | null {
  const prefix = `${SESSION_COOKIE}=`;
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(prefix));
  const value = cookie?.slice(prefix.length).split(';')[0] ?? '';
  return value === '' ? null : value;
}

async function live(rawId: string): Promise<boolean> {
  return (
    (await readSession(env.DB, deps().secret, rawId, Date.now(), DEFAULT_POLICY.sessionIdleMs)) !==
    null
  );
}

/** Posts a Verify step carrying `planted`'s session cookie and token beside the ceremony's challenge cookie. */
function verify(
  name: string,
  planted: Caller,
  challengeId: string,
  body: object,
): Promise<Response> {
  return exports.default.fetch(
    new Request(`${ORIGIN}/_actions/${name}`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        'content-type': 'application/json',
        cookie: `${SESSION_COOKIE}=${planted.raw}; ${CHALLENGE_COOKIE}=${challengeId}`,
      },
      body: JSON.stringify({ _csrf: planted.token, ...body }),
    }),
  );
}

async function passkeyLogin(planted: Caller, back?: string): Promise<Response> {
  const person = await enrolledPerson();
  const d = deps();
  const { options, challengeId } = await loginOptions(d, Date.now());
  const response = await person.authenticator.assert(options, d.rp.origin);
  return verify('auth.loginVerify', planted, challengeId, { response, return: back });
}

async function enrolment(planted: Caller): Promise<Response> {
  const d = deps();
  const person = await addPerson();
  const token = await issueEnrolment(await adminScope(), d.db, d.secret, person.id, Date.now());
  const authenticator = await createSoftwareAuthenticator();
  const { options, challengeId } = await enrolOptions(d, token, Date.now());
  const response = await authenticator.register(options, d.rp.origin);
  return verify('auth.enrolVerify', planted, challengeId, { token, response });
}

async function recovery(planted: Caller): Promise<Response> {
  const person = await enrolledPerson();
  return rpcForm('auth.recover', planted, { email: person.email, code: person.codes[0] ?? '' });
}

describe('SEC-06 a new session id at every sign-in', () => {
  const ways: [string, (planted: Caller) => Promise<Response>][] = [
    ['a passkey login', passkeyLogin],
    ['an enrolment', enrolment],
    ['a recovery', recovery],
  ];
  for (const [way, signIn] of ways) {
    it(`SEC-06 ${way} with a session cookie already set ends that session and sets a different id`, async () => {
      const planted = await caller([]);
      expect(await live(planted.raw)).toBe(true);
      const response = await signIn(planted);
      expect(response.status).toBe(200);
      const fresh = setSession(response);
      expect(fresh).not.toBeNull();
      expect(fresh).not.toBe(planted.raw);
      expect(await live(planted.raw)).toBe(false);
      expect(await live(fresh ?? '')).toBe(true);
    });
  }
});

describe('a passkey login goes on to the page asked for', () => {
  it('SEC-51 a same-site return is followed, anything else goes to the week', async () => {
    const next = async (back?: string) => (await passkeyLogin(await caller([]), back)).text();
    expect(await next('/clients')).toContain('/clients');
    for (const bad of [
      '//evil.example',
      'https://evil.example/x',
      '/\\evil.example',
      '/auth/sso/enrol?token=t',
    ]) {
      const body = await next(bad);
      expect(body, bad).toContain('/week');
      expect(body, bad).not.toContain('evil');
      expect(body, bad).not.toContain('/auth');
    }
  });
});

describe('adding a passkey ends where the new passkey is listed', () => {
  it('auth.addPasskeyVerify sends the person on to the account page, not the week', async () => {
    const who = await caller([]);
    const d = deps();
    const session = await readSession(
      env.DB,
      d.secret,
      who.raw,
      Date.now(),
      DEFAULT_POLICY.sessionIdleMs,
    );
    if (!session) return expect.unreachable('the caller has a session');
    const { options, challengeId } = await addPasskeyOptions(d, session, Date.now());
    const authenticator = await createSoftwareAuthenticator();
    const response = await authenticator.register(options, d.rp.origin);
    const added = await verify('auth.addPasskeyVerify', who, challengeId, { response });
    expect(added.status).toBe(200);
    const body = await added.text();
    expect(body).toContain('/account');
    expect(body).not.toContain('/week');
  });
});
