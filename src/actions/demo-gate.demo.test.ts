// Through the built Worker with the demo's gate open (the `demo` project): the persona guards are wired into every
// Action that could hand a visitor a way back into a shared account, and the sign-in counts every guess.
import { env, exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { demoPeople } from '../../test/demo/build';
import { demoSeedStatements } from '../../test/demo/seed';
import { ORIGIN, rpc, rpcForm, type Caller } from '../../test/helpers/callers';
import { DEMO_SESSION_MS, readSession } from '../auth/session';
import { csrfToken } from '../auth/tokens';
import { DEMO_PERSONAS } from '../lib/demo-personas';
import { currentEnv } from '../lib/env';
import { DEFAULT_POLICY } from '../lib/policy';

const PASSWORD = 'a-long-demo-<&"pass';
const [member, , , manager] = DEMO_PERSONAS;
const stranger = demoPeople().find((p) => !DEMO_PERSONAS.some((d) => d.id === p.id));

beforeAll(async () => {
  await env.DB.exec((await demoSeedStatements(currentEnv().NOTE_KEK, '2026-11-16')).join('\n'));
});

/** POST the sign-in form from `ip`; the cookie it sets, if any. */
async function signIn(
  persona: string,
  password: string,
  ip: string,
  cookie?: string,
): Promise<{ status: number; raw: string | null; cookie: string }> {
  const headers = new Headers({
    origin: ORIGIN,
    'content-type': 'application/x-www-form-urlencoded',
    'cf-connecting-ip': ip,
  });
  if (cookie) headers.set('cookie', cookie);
  const response = await exports.default.fetch(
    new Request(`${ORIGIN}/_actions/auth.demoSignin`, {
      method: 'POST',
      headers,
      body: new URLSearchParams({
        password,
        persona,
        ...(cookie
          ? { _csrf: await csrfToken(currentEnv().SESSION_SECRET, cookie.split('=')[1] ?? '') }
          : {}),
      }).toString(),
    }),
  );
  const set = response.headers.getSetCookie().find((c) => c.startsWith('__Host-tidwick-session='));
  return {
    status: response.status,
    raw: set?.split(';')[0]?.split('=')[1] ?? null,
    cookie: set ?? '',
  };
}

async function asPersona(persona: string, ip: string): Promise<Caller> {
  const { raw } = await signIn(persona, PASSWORD, ip);
  const rawId = raw ?? expect.unreachable('no session cookie');
  return {
    personId: DEMO_PERSONAS.find((p) => p.key === persona)?.id ?? '',
    raw: rawId,
    token: await csrfToken(currentEnv().SESSION_SECRET, rawId),
  };
}

describe('the persona guards are wired into their Actions', () => {
  const onOthers = [
    'people.setRoles',
    'people.issueEnrolment',
    'people.offboard',
    'people.reenrol',
    'people.unlock',
  ];

  it.each(onOthers)('%s refuses a persona and accepts anyone else', async (name) => {
    const admin = await asPersona(manager.key, '203.0.113.50');
    const refused = await rpcForm(name, admin, { id: member.id });
    expect(refused.status).toBe(403);
    const allowed = await rpcForm(name, admin, { id: stranger?.id ?? '' });
    expect(allowed.status).not.toBe(403);
  });

  it('auth.addPasskeyOptions, addPasskeyVerify and regenerateCodes refuse a signed-in persona', async () => {
    const who = await asPersona(member.key, '203.0.113.51');
    const credential = { id: 'x', rawId: 'x', type: 'public-key', response: {} };
    expect((await rpc('auth.addPasskeyOptions', who)).status).toBe(403);
    expect((await rpc('auth.addPasskeyVerify', who, { response: credential })).status).toBe(403);
    expect((await rpcForm('auth.regenerateCodes', who)).status).toBe(403);
  });
});

describe('the sign-in', () => {
  it('lives two hours in the cookie, and a switch ends the session it replaces', async () => {
    const first = await signIn(member.key, PASSWORD, '203.0.113.60');
    expect(first.cookie).toContain(`Max-Age=${String(DEMO_SESSION_MS / 1000)}`);
    const second = await signIn(
      manager.key,
      PASSWORD,
      '203.0.113.60',
      `__Host-tidwick-session=${first.raw ?? ''}`,
    );
    const { SESSION_SECRET } = currentEnv();
    expect(
      await readSession(
        env.DB,
        SESSION_SECRET,
        first.raw ?? '',
        Date.now(),
        DEFAULT_POLICY.sessionIdleMs,
      ),
    ).toBeNull();
    expect(
      await readSession(
        env.DB,
        SESSION_SECRET,
        second.raw ?? '',
        Date.now(),
        DEFAULT_POLICY.sessionIdleMs,
      ),
    ).not.toBeNull();
  });

  it('counts every guess: the 31st in a minute is refused, even with the right password', async () => {
    const ip = '203.0.113.61';
    for (let i = 0; i < 30; i++) {
      const guess = await signIn(member.key, `wrong-guess-number-${String(i)}`, ip);
      expect(guess.status).toBe(401);
    }
    const refused = await signIn(member.key, PASSWORD, ip);
    expect(refused.status).toBe(429);
    expect(refused.raw).toBeNull();
  });

  it('a right password signs in on the 30th attempt, which is still allowed', async () => {
    const ip = '203.0.113.62';
    for (let i = 0; i < 29; i++) await signIn(member.key, `wrong-guess-number-${String(i)}`, ip);
    expect((await signIn(member.key, PASSWORD, ip)).raw).not.toBeNull();
  });
});
