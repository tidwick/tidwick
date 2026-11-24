import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { dropStatements } from '../../test/demo/reset';
import { demoSeedStatements } from '../../test/demo/seed';
import { currentEnv } from '../lib/env';

const { TEST_MIGRATIONS } = env as unknown as { TEST_MIGRATIONS: D1Migration[] };

async function tables(): Promise<string[]> {
  const found = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type IN ('table', 'trigger', 'index') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
  ).all<{ name: string }>();
  return found.results.map((row) => row.name);
}

describe('the demo reset', () => {
  it('drops every table, trigger and index, audit log and migration log included, then migrates and seeds again', async () => {
    const seed = (await demoSeedStatements(currentEnv().NOTE_KEK, '2026-11-16')).join('\n');
    await env.DB.exec(seed);
    await env.DB.exec(
      "INSERT INTO audit_event (seq, at, action, target, prev_hash, hash) VALUES (1, 1, 'demo', 'x', '" +
        '0'.repeat(64) +
        "', 'h1')",
    );
    expect(await tables()).toContain('audit_event');
    await env.DB.exec(dropStatements().join('\n'));
    expect(await tables()).toEqual([]);

    await applyD1Migrations(env.DB, TEST_MIGRATIONS);
    await env.DB.exec(seed);
    const people = await env.DB.prepare('SELECT count(*) AS n FROM person').first<{ n: number }>();
    expect(people?.n).toBe(25);
    const events = await env.DB.prepare('SELECT count(*) AS n FROM audit_event').first<{
      n: number;
    }>();
    expect(events?.n).toBe(0);
  });
});
