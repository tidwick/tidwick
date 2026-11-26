import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { demoSeedStatements } from '../../test/demo/seed';
import { demoSignIn } from '../auth/demo';
import { DEMO_RESET_CRON, scheduled } from '../backup/scheduled';
import { DEMO_PERSONAS } from '../lib/demo-personas';
import { currentEnv } from '../lib/env';
import { D1_QUERIES_PER_INVOCATION } from '../lib/limits';
import { checkChain } from './audit';
import { wipeDemo } from './demo-wipe';
import { instanceEmpty } from './empty';

const NOW = Date.UTC(2026, 10, 18, 4, 0, 0);
const OPEN = {
  ...currentEnv(),
  DEMO_LOGIN: true,
  DEMO_BANNER: true,
  DEMO_PASSWORD: 'a-long-demo-password',
};
const TABLES = ['person', 'person_role', 'project', 'week_row', 'entry', 'client_key', 'setting'];

async function counts(): Promise<number[]> {
  return Promise.all(
    TABLES.map(async (t) => {
      const row = await env.DB.prepare(`SELECT count(*) AS n FROM ${t}`).first<{ n: number }>();
      return row?.n ?? -1;
    }),
  );
}

const triggers = async (): Promise<string[]> =>
  (
    await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name",
    ).all<{
      name: string;
    }>()
  ).results.map((r) => r.name);

describe('the nightly demo wipe', () => {
  it('puts a messed-up demo back as the seed made it: counts equal, audit log verifies, triggers kept', async () => {
    const kek = currentEnv().NOTE_KEK;
    await env.DB.exec((await demoSeedStatements(kek, '2026-11-16')).join('\n'));
    const seeded = await counts();
    const kept = await triggers();
    expect(kept.length).toBeGreaterThan(0);

    await demoSignIn(OPEN, 'a-long-demo-password', 'manager', NOW);
    await env.DB.exec(
      "DELETE FROM entry; INSERT INTO client (id, name, created_at) VALUES ('junk', 'Junk', 1);",
    );
    expect(await counts()).not.toEqual(seeded);

    const cron = { cron: DEMO_RESET_CRON, scheduledTime: NOW } as ScheduledController;
    await scheduled(cron, env);
    expect(await counts()).not.toEqual(seeded);

    const open = { ...env, DEMO_LOGIN: 'on', DEMO_BANNER: 'on', DEMO_PASSWORD: OPEN.DEMO_PASSWORD };
    // Signals alone are not enough: a database the seed never marked is left alone.
    await env.DB.exec("DELETE FROM setting WHERE key = 'demo'");
    await scheduled(cron, { ...env, DEMO_LOGIN: 'on', DEMO_BANNER: 'on' });
    expect(await counts()).not.toEqual(seeded);
    await env.DB.exec("INSERT INTO setting (key, value_json) VALUES ('demo', '1')");
    // A closed sign-in gate (no password) still wipes while the banner says it is the demo.
    await scheduled(cron, { ...env, DEMO_BANNER: 'on' });
    expect(await counts()).toEqual(seeded);
    await env.DB.exec('DELETE FROM entry');
    expect(await counts()).not.toEqual(seeded);
    await scheduled(cron, open);
    expect(await counts()).toEqual(seeded);
    expect(await triggers()).toEqual(kept);
    const log = await env.DB.prepare('SELECT count(*) AS n FROM audit_event').first<{
      n: number;
    }>();
    const live = await env.DB.prepare('SELECT count(*) AS n FROM session').first<{ n: number }>();
    expect([log?.n, live?.n]).toEqual([1, 0]);
    const first = await env.DB.prepare('SELECT seq, action, actor_id FROM audit_event').first();
    expect(first).toEqual({ seq: 1, action: 'demo.reset', actor_id: null });
    expect((await checkChain(env.DB)).ok).toBe(true);
    await demoSignIn(OPEN, 'a-long-demo-password', DEMO_PERSONAS[0].key, NOW);
    await expect(env.DB.exec('DELETE FROM audit_event')).rejects.toThrow();
  });

  it('leaves the seed admin in place, so the setup gate stays shut after a wipe', async () => {
    await wipeDemo(env.DB, currentEnv().NOTE_KEK, NOW);
    expect(await instanceEmpty(env.DB)).toBe(false);
  });

  it('a whole scheduled reset stays at or under 900 queries, so seed growth fails here and not at 04:00', async () => {
    let prepared = 0;
    const batches: number[] = [];
    const spy = new Proxy(env.DB, {
      get(target, key) {
        const value = Reflect.get(target, key) as (...args: unknown[]) => unknown;
        if (key === 'prepare')
          return (sql: string) => {
            prepared += 1;
            return value.call(target, sql);
          };
        if (key === 'batch')
          return (statements: D1PreparedStatement[]) => {
            batches.push(statements.length);
            return value.call(target, statements);
          };
        return value.bind(target);
      },
    });
    const cron = { cron: DEMO_RESET_CRON, scheduledTime: NOW } as ScheduledController;
    await scheduled(cron, {
      ...env,
      DB: spy,
      DEMO_LOGIN: 'on',
      DEMO_BANNER: 'on',
      DEMO_PASSWORD: OPEN.DEMO_PASSWORD,
    });
    expect(batches, 'the reset must run as one batch').toHaveLength(1);
    expect(
      prepared,
      `the reset prepared ${String(prepared)} queries (D1 allows ${String(D1_QUERIES_PER_INVOCATION)} per invocation; keep it at 900 or under): merge seed INSERTs into multi-row statements (test/demo/weeks.ts multiRow); never split the batch, the audit triggers would stay dropped between batches`,
    ).toBeLessThanOrEqual(900);
    console.info(`demo reset: batch ${String(batches[0])}, invocation ${String(prepared)}`);
  });
});
