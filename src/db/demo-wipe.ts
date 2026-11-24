// The nightly demo wipe. Not scanned by the SQL-binding test: it runs the seed's own statements and the trigger SQL
// stored in sqlite_master, built from constants and the seed, with no request value anywhere in it.
import { DROP_ORDER } from '../../test/demo/reset.ts';
import { demoSeedStatements } from '../../test/demo/seed.ts';
import { todayIn, weekStartOf } from '../lib/week';

/**
 * Puts the demo back as the seed made it, in one atomic batch: the audit triggers drop (they forbid deleting the
 * log), every table but the migration log empties children first, the seed loads for the week `now` falls in, and
 * the triggers come back as they were. A batch that fails leaves yesterday's data.
 */
export async function wipeDemo(db: D1Database, kek: string, now: number): Promise<number> {
  const week = weekStartOf(todayIn('UTC', now));
  if (week === null) throw new Error('today has no week start');
  const found = await db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND sql IS NOT NULL")
    .all<{ name: string; sql: string }>();
  const seed = await demoSeedStatements(kek, week);
  const statements = [
    ...found.results.map((t) => `DROP TRIGGER ${t.name}`),
    ...DROP_ORDER.filter((table) => table !== 'd1_migrations').map((t) => `DELETE FROM ${t}`),
    ...seed,
    ...found.results.map((t) => t.sql),
  ];
  await db.batch(statements.map((sql) => db.prepare(sql)));
  return seed.length;
}
