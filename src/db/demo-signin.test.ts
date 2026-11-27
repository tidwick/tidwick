import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { demoPeople } from '../../test/demo/build';
import { demoSeedStatements } from '../../test/demo/seed';
import { checkChain } from './audit';
import { grantsOf } from './roles';
import { DEMO_PERSONAS } from '../lib/demo-personas';
import { currentEnv, type Env } from '../lib/env';
import { AppError } from '../lib/errors';
import { demoOpen, demoSignIn, guardPersona } from '../auth/demo';
import { DEMO_SESSION_MS, newSession, readSession } from '../auth/session';
import { requireStepUp } from '../auth/step-up';
import { DEFAULT_POLICY } from '../lib/policy';

const OPEN: Env = { ...currentEnv(), DEMO_LOGIN: true, DEMO_BANNER: true };
const NOW = Date.UTC(2026, 10, 18, 10, 0, 0);

beforeAll(async () => {
  await env.DB.exec((await demoSeedStatements(currentEnv().NOTE_KEK, '2026-11-16')).join('\n'));
});

async function count(sql: string, ...binds: string[]): Promise<number> {
  const row = await env.DB.prepare(sql)
    .bind(...binds)
    .first<{ n: number }>();
  return row?.n ?? -1;
}

const sessions = (id: string) =>
  count('SELECT count(*) AS n FROM session WHERE person_id = ?1', id);

describe('the demo sign-in gate', () => {
  it('opens only when the var, the banner and the seed marker all hold', async () => {
    expect(await demoOpen(OPEN)).toBe(true);
  });

  it('each signal missing alone closes it', async () => {
    expect(await demoOpen({ ...OPEN, DEMO_LOGIN: false })).toBe(false);
    expect(await demoOpen({ ...OPEN, DEMO_BANNER: false })).toBe(false);
    await env.DB.exec("DELETE FROM setting WHERE key = 'demo'");
    expect(await demoOpen(OPEN)).toBe(false);
    await env.DB.exec("INSERT INTO setting (key, value_json) VALUES ('demo', '1')");
    expect(await demoOpen(OPEN)).toBe(true);
  });

  it('a closed gate is not_found and opens no session', async () => {
    const who = DEMO_PERSONAS[0];
    for (const closed of [
      { ...OPEN, DEMO_LOGIN: false },
      { ...OPEN, DEMO_BANNER: false },
    ]) {
      const before = await sessions(who.id);
      const error = await demoSignIn(closed, who.key, NOW).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('not_found');
      expect(await sessions(who.id)).toBe(before);
    }
  });

  it('the seeded people, names and grants are the four personas', async () => {
    const people = demoPeople();
    for (const p of DEMO_PERSONAS) {
      expect(people.find((x) => x.id === p.id)?.name).toBe(p.name);
    }
    const grants = await Promise.all(DEMO_PERSONAS.map((p) => grantsOf(env.DB, p.id)));
    expect(grants).toEqual([[], [], ['accounting_admin'], ['admin']]);
  });
});

describe('auth.demoSignin', () => {
  it('a pick opens a 2 hour session as the persona, audited in the same batch', async () => {
    const who = DEMO_PERSONAS[2];
    const raw = await demoSignIn(OPEN, who.key, NOW);
    const session = await readSession(
      env.DB,
      OPEN.SESSION_SECRET,
      raw,
      NOW,
      DEFAULT_POLICY.sessionIdleMs,
    );
    expect(session?.personId).toBe(who.id);
    const row = await env.DB.prepare(
      'SELECT expires_at, step_up_at FROM session WHERE person_id = ?1',
    )
      .bind(who.id)
      .first<{ expires_at: number; step_up_at: number }>();
    expect(row?.expires_at).toBe(NOW + DEMO_SESSION_MS);
    const event = await env.DB.prepare(
      "SELECT actor_id, target, after_json FROM audit_event WHERE action = 'auth.demoSignin'",
    ).first<{ actor_id: string; target: string; after_json: string }>();
    expect(event?.actor_id).toBe(who.id);
    expect(JSON.parse(event?.after_json ?? '{}')).toEqual({ persona: 'approver' });
    expect((await checkChain(env.DB)).ok).toBe(true);
    expect(
      await readSession(
        env.DB,
        OPEN.SESSION_SECRET,
        raw,
        NOW + DEMO_SESSION_MS,
        DEFAULT_POLICY.sessionIdleMs,
      ),
    ).toBeNull();
  });

  it('the session passes the step-up gate for its whole life, which a passkey session does not', async () => {
    const who = DEMO_PERSONAS[3];
    const raw = await demoSignIn(OPEN, who.key, NOW);
    const demo = await readSession(
      env.DB,
      OPEN.SESSION_SECRET,
      raw,
      NOW,
      DEFAULT_POLICY.sessionIdleMs,
    );
    const late = NOW + DEMO_SESSION_MS - 1;
    expect(() => {
      requireStepUp(demo ?? expect.unreachable('no session'), late, DEFAULT_POLICY.stepUpMs);
    }).not.toThrow();
    const passkey = await newSession(
      env.DB,
      OPEN.SESSION_SECRET,
      who.id,
      NOW,
      DEFAULT_POLICY.sessionMaxMs,
    );
    await passkey.statement.run();
    const plain = await readSession(
      env.DB,
      OPEN.SESSION_SECRET,
      passkey.rawId,
      NOW,
      DEFAULT_POLICY.sessionIdleMs,
    );
    expect(plain?.stepUpAt).toBe(NOW);
    expect(() => {
      requireStepUp(
        plain ?? expect.unreachable('no session'),
        NOW + DEFAULT_POLICY.stepUpMs,
        DEFAULT_POLICY.stepUpMs,
      );
    }).toThrow();
  });
});

describe('the persona guard', () => {
  it('refuses a persona while the gate holds, and nobody else', async () => {
    const [persona] = DEMO_PERSONAS;
    const other = demoPeople().find((p) => !DEMO_PERSONAS.some((d) => d.id === p.id));
    await expect(guardPersona(OPEN, persona.id)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(guardPersona(OPEN, other?.id ?? '')).resolves.toBeUndefined();
  });

  it('does nothing where the gate is closed', async () => {
    await expect(
      guardPersona({ ...OPEN, DEMO_LOGIN: false }, DEMO_PERSONAS[0].id),
    ).resolves.toBeUndefined();
  });
});
