import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { demoSeedStatements } from '../../test/demo/seed';
import { loadSeed } from '../../test/seed/load';
import { seedStatements } from '../../test/seed/build';
import { currentEnv } from '../lib/env';

async function count(sql: string): Promise<number> {
  const row = await env.DB.prepare(sql).first<{ n: number }>();
  return row?.n ?? -1;
}

const ids = (statements: readonly string[]): Set<string> =>
  new Set(statements.join('\n').match(/[0-9a-f]{8}-0000-4000-8000-[0-9]{12}/g) ?? []);

describe('the demo seed is not the test seed', () => {
  it('shares no id with the test seed', async () => {
    const demo = ids(await demoSeedStatements(currentEnv().NOTE_KEK, '2026-11-16'));
    const test = ids(seedStatements());
    expect(demo.size).toBeGreaterThan(100);
    expect([...demo].filter((id) => test.has(id))).toEqual([]);
  });

  it('loads beside the test seed with no firm, client, person, task code or project name in common', async () => {
    await loadSeed(env.DB, currentEnv().NOTE_KEK);
    await env.DB.exec((await demoSeedStatements(currentEnv().NOTE_KEK, '2026-11-16')).join('\n'));
    expect(await count('SELECT count(*) AS n FROM firm')).toBe(2 + 2);
    expect(await count('SELECT count(*) AS n FROM client')).toBe(10 + 7);
    expect(await count('SELECT count(*) AS n FROM person')).toBe(100 + 26);
    expect(await count('SELECT count(*) AS n FROM task_code')).toBe(8 + 8);
    expect(await count('SELECT count(*) AS n FROM project')).toBe(40 + 12);
    for (const table of ['project', 'person']) {
      const shared = `SELECT count(*) AS n FROM ${table} d JOIN ${table} t ON lower(d.name) = lower(t.name)
        WHERE d.id LIKE '5%' AND t.id NOT LIKE '5%'`;
      expect(await count(shared), table).toBe(0);
    }
  });
});
