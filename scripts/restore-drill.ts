// Compares a restored local D1 with its source: rows per kept table, a digest of every row's content and the audit chain head.
// Usage: node scripts/restore-drill.ts <source persist dir> <restored persist dir>
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import { BACKUP_TABLES, chainHead, countRows } from '../src/db/backup-rows.ts';

const [source, restored] = process.argv.slice(2);
if (source === undefined || restored === undefined) {
  console.error(
    'FAIL restore-drill: usage: restore-drill.ts <source persist dir> <restored persist dir>',
  );
  process.exit(1);
}

interface Snapshot {
  counts: Map<string, number>;
  digests: Map<string, string>;
  head: { seq: number; hash: string };
}

/** One hash over a table's rows, each as JSON, sorted, so row order and rowids do not matter but any byte of content does. */
async function digest(db: D1Database, table: string, skipNewest: boolean): Promise<string> {
  const { results } = await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
  const rows = skipNewest ? results.slice(0, -1) : results;
  const lines = rows.map((row) => JSON.stringify(row)).toSorted();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

async function snapshot(path: string, isSource: boolean): Promise<Snapshot> {
  const { env, dispose } = await getPlatformProxy<{ DB: D1Database }>({
    configPath: 'test/wrangler.test.jsonc',
    persist: { path: `${path}/v3` },
  });
  try {
    const counts = new Map<string, number>();
    const digests = new Map<string, string>();
    for (const table of BACKUP_TABLES) {
      counts.set(table, await countRows(env.DB, table));
      // The source also holds the run that wrote the backup, which the file cannot contain.
      digests.set(table, await digest(env.DB, table, isSource && table === 'backup_run'));
    }
    return { counts, digests, head: await chainHead(env.DB) };
  } finally {
    await dispose();
  }
}

const before = await snapshot(source, true);
const after = await snapshot(restored, false);
// The source also holds the run that wrote the backup, which the file cannot contain.
const expected = (table: string) =>
  (before.counts.get(table) ?? 0) - (table === 'backup_run' ? 1 : 0);

let ok = true;
console.log(`${'table'.padEnd(16)} ${'source'.padStart(7)} ${'restored'.padStart(8)} digest`);
for (const table of BACKUP_TABLES) {
  const same = before.digests.get(table) === after.digests.get(table);
  const match = expected(table) === after.counts.get(table) && same;
  ok &&= match;
  console.log(
    `${table.padEnd(16)} ${String(expected(table)).padStart(7)} ${String(after.counts.get(table)).padStart(8)} ${match ? `ok ${(after.digests.get(table) ?? '').slice(0, 12)}` : `MISMATCH ${same ? 'count' : 'content'}`}`,
  );
}
const sqlMode = statSync(`${restored}/restore.sql`).mode & 0o777;
if ((sqlMode & 0o077) !== 0) {
  console.error(
    `FAIL restore-drill: ${restored}/restore.sql is mode ${sqlMode.toString(8)}, readable beyond its owner; write it with mode 0600 in scripts/restore.ts`,
  );
  process.exit(1);
}
const headMatch = before.head.seq === after.head.seq && before.head.hash === after.head.hash;
ok &&= headMatch;
console.log(`chain head       ${String(before.head.seq)} ${before.head.hash}`);
console.log(
  `restored head    ${String(after.head.seq)} ${after.head.hash} ${headMatch ? 'ok' : 'MISMATCH'}`,
);
if (!ok) {
  console.error(
    'FAIL restore-drill: the restored database differs from its source; read the MISMATCH rows above and fix the backup or restore step for those tables',
  );
  process.exit(1);
}
console.log('PASS restore-drill: every table count, every table content digest and the chain head match the source');
