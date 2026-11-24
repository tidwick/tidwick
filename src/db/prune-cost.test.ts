// The two tables a public call writes are pruned on every write. Each prune walks an index on the column it
// reads, so its cost is the rows it deletes, not the table a flood of calls has grown (ADR 0003).
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { insertChallenge } from './challenges';
import { countFailure, PRUNE_AFTER_MS } from './recovery-attempts';

const NOW = Date.UTC(2026, 0, 5, 9);
const MINUTE = 60_000;
const LIVE = 2_000;
const STALE = 50;

/** Each statement's text and its D1 result, for batches and single runs, passed through to the real database. */
function metered(db: D1Database): { db: D1Database; ran: { sql: string; meta: D1Meta }[] } {
  const ran: { sql: string; meta: D1Meta }[] = [];
  const texts = new WeakMap<D1PreparedStatement, string>();
  const tracked = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => {
    texts.set(statement, sql);
    const bind = statement.bind.bind(statement);
    const run = statement.run.bind(statement);
    return Object.assign(statement, {
      bind: (...values: unknown[]) => tracked(bind(...values), sql),
      run: async () => {
        const result = await run();
        ran.push({ sql, meta: result.meta });
        return result;
      },
    });
  };
  const spy = {
    prepare: (sql: string) => tracked(db.prepare(sql), sql),
    batch: async (statements: D1PreparedStatement[]) => {
      const results = await db.batch(statements);
      results.forEach((result, i) => {
        const statement = statements[i];
        ran.push({ sql: statement ? (texts.get(statement) ?? '') : '', meta: result.meta });
      });
      return results;
    },
  };
  return { db: spy as unknown as D1Database, ran };
}

/** Stores `count` rows through one INSERT … SELECT over a counter `i`, with `?2` bound to `at`. */
async function fill(sql: string, count: number, at: number): Promise<void> {
  await env.DB.prepare(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?1) ${sql}`,
  )
    .bind(count, at)
    .run();
}

const pruneOf = (ran: { sql: string; meta: D1Meta }[]) =>
  ran.find((r) => r.sql.startsWith('DELETE'))?.meta;

describe('SEC-37 a prune on the public paths reads the rows it deletes', () => {
  it('SEC-37 a challenge insert deletes every expired challenge, keeps the live ones, and reads about what it deletes', async () => {
    await fill(
      `INSERT INTO auth_challenge (id_hash, purpose, challenge, expires_at)
       SELECT 'live-' || i, 'login', 'c', ?2 FROM n`,
      LIVE,
      NOW + 5 * MINUTE,
    );
    await fill(
      `INSERT INTO auth_challenge (id_hash, purpose, challenge, expires_at)
       SELECT 'stale-' || i, 'login', 'c', ?2 - i FROM n`,
      STALE,
      NOW - MINUTE,
    );
    const { db, ran } = metered(env.DB);
    const row = { idHash: 'fresh', purpose: 'login' as const, personId: null, challenge: 'c' };
    await insertChallenge(db, { ...row, expiresAt: NOW + 5 * MINUTE }, NOW);

    const prune = pruneOf(ran);
    expect(prune?.changes).toBe(STALE);
    expect(prune?.rows_read ?? Infinity).toBeLessThan(STALE * 3);
    const left = await env.DB.prepare(
      "SELECT count(*) AS live, sum(id_hash LIKE 'stale-%') AS stale FROM auth_challenge",
    ).first<{ live: number; stale: number }>();
    expect(left).toEqual({ live: LIVE + 1, stale: 0 });
  });

  it('SEC-37 a recovery failure prunes counters a day old and unlocked, keeps a locked one, and reads about what it deletes', async () => {
    await fill(
      `INSERT INTO recovery_attempt (email_hash, failures, failed_at)
       SELECT 'recent-' || i, 1, ?2 FROM n`,
      LIVE,
      NOW - MINUTE,
    );
    await fill(
      `INSERT INTO recovery_attempt (email_hash, failures, failed_at)
       SELECT 'old-' || i, 1, ?2 - i FROM n`,
      STALE,
      NOW - PRUNE_AFTER_MS - MINUTE,
    );
    await env.DB.prepare(
      "INSERT INTO recovery_attempt (email_hash, failures, locked_until, failed_at) VALUES ('locked', 5, ?1, 0)",
    )
      .bind(NOW + MINUTE)
      .run();
    const { db, ran } = metered(env.DB);
    await countFailure(db, 'someone', NOW);

    const prune = pruneOf(ran);
    expect(prune?.changes).toBe(STALE);
    expect(prune?.rows_read ?? Infinity).toBeLessThan(STALE * 3);
    const left = await env.DB.prepare(
      "SELECT count(*) AS n, sum(email_hash LIKE 'old-%') AS old, sum(email_hash = 'locked') AS locked FROM recovery_attempt",
    ).first<{ n: number; old: number; locked: number }>();
    expect(left).toEqual({ n: LIVE + 2, old: 0, locked: 1 });
  });
});
