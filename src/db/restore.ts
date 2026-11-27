// The restore's checks and the SQL text that loads a backup's rows into a freshly migrated database, one statement
// per line, for `wrangler d1 execute --file`. Only the restore script and its tests use it; nothing is prepared.
import {
  parseBackup,
  rowsDigest,
  type BackupHeader,
  type BackupLine,
} from '../lib/backup-format.ts';
import { GENESIS, verifyLinks, type ChainLink, type Head } from '../lib/chain.ts';
import { BACKUP_TABLES } from './backup-rows.ts';
import { literal } from './sql-text.ts';

const TABLES: ReadonlySet<string> = new Set(BACKUP_TABLES);
const COLUMN = /^[a-z][a-z0-9_]*$/;

export type Statement = { ok: true; sql: string } | { ok: false; why: string };

/** One INSERT for one backed-up row; a table or column the backup format never writes is refused. */
export function insertFor(line: BackupLine): Statement {
  if (!TABLES.has(line.t)) return { ok: false, why: `unknown table ${line.t}` };
  const columns = Object.keys(line.r);
  const bad = columns.find((c) => !COLUMN.test(c));
  if (bad !== undefined || columns.length === 0) {
    return { ok: false, why: `bad column in ${line.t}: ${bad ?? '(none)'}` };
  }
  const values = columns.map((c) => literal(line.r[c] ?? null));
  const i = values.indexOf(null);
  if (i !== -1) return { ok: false, why: `not an integer in ${line.t}.${columns[i] ?? ''}` };
  return {
    ok: true,
    sql: `INSERT INTO ${line.t} (${columns.join(', ')}) VALUES (${values.join(', ')});`,
  };
}

/** Rows grouped back into restore order, whatever order the file held them in. */
export function inRestoreOrder(lines: readonly BackupLine[]): BackupLine[] {
  const rank = new Map<string, number>(BACKUP_TABLES.map((t, i) => [t, i]));
  return lines
    .map((line, i) => ({ line, i }))
    .toSorted((a, b) => (rank.get(a.line.t) ?? 0) - (rank.get(b.line.t) ?? 0) || a.i - b.i)
    .map(({ line }) => line);
}

/**
 * The first statement of every restore file: it fails NOT NULL unless every table a backup fills is empty, so a
 * load into a database that already holds rows, the same backup loaded twice included, writes nothing.
 */
export const EMPTY_TARGET = `INSERT INTO setting (key, value_json) SELECT 'restore_target', NULL WHERE ${BACKUP_TABLES.map(
  (t) => `EXISTS (SELECT 1 FROM ${t})`,
).join(' OR ')};`;

export type RestorePlan =
  | { ok: true; header: BackupHeader; sql: string[]; counts: Map<string, number> }
  | { ok: false; why: string };

/** What an operator records off the file for one backup: its audit head and the digest of every other row. */
export type Recorded = Head & { digest: string };

/** The value an operator recorded, written `<seq>:<hash>:<digest>` as the settings page shows it; null when it is not that. */
export function parseHead(value: string): Recorded | null {
  const found = /^(\d{1,15}):([0-9a-f]{64}):([0-9a-f]{64})$/.exec(value.trim());
  return found === null
    ? null
    : { seq: Number(found[1]), hash: found[2] ?? '', digest: found[3] ?? '' };
}

/**
 * Checks a decrypted backup, its header, its schema version against `latestMigration` (this checkout's last
 * migration file), its audit chain against the header's head and against `expected`, and every other row against
 * the digest in `expected`, all recorded by the operator outside the backup, then builds the SQL that loads it,
 * guard first. Chain and digest are unkeyed, so anyone able to write a backup object can forge a self-consistent
 * file; only the recorded value, covering the whole file, tells a forged file from the one tidwick wrote.
 */
export async function planRestore(
  text: string,
  latestMigration: string | null,
  expected: Recorded,
): Promise<RestorePlan> {
  const parsed = parseBackup(text);
  if (!parsed.ok)
    return { ok: false, why: `${parsed.why}; the file is damaged or not a tidwick backup` };
  const { header, lines, rows } = parsed;
  if (header.schema_version !== null && header.schema_version !== latestMigration) {
    return {
      ok: false,
      why: `the backup was taken at migration ${header.schema_version} and this checkout ends at ${String(latestMigration)}; check out the release whose migrations end at ${header.schema_version}`,
    };
  }
  const events = lines.filter((l) => l.t === 'audit_event').map((l) => l.r as unknown as ChainLink);
  const verdict = await verifyLinks({ seq: 0, hash: GENESIS }, events);
  if (!verdict.ok) {
    return {
      ok: false,
      why: `the audit chain in the backup breaks at seq ${String(verdict.brokenSeq)}; do not load it, keep the file for review`,
    };
  }
  if (verdict.head.seq !== header.chain_seq || verdict.head.hash !== header.chain_head) {
    return {
      ok: false,
      why: `the audit chain ends at seq ${String(verdict.head.seq)} but the header records ${String(header.chain_seq)}; the file is not the one written`,
    };
  }
  if (verdict.head.seq !== expected.seq || verdict.head.hash !== expected.hash) {
    return {
      ok: false,
      why: `the backup's audit chain ends at seq ${String(verdict.head.seq)}, which is not the head you recorded (seq ${String(expected.seq)}); do not load it, keep the file for review, and restore the backup whose head you recorded`,
    };
  }
  if ((await rowsDigest(rows)) !== expected.digest) {
    return {
      ok: false,
      why: 'the rows other than the audit events are not the ones you recorded the digest for; do not load it, keep the file for review, and restore the backup whose value you recorded',
    };
  }
  const sql = [EMPTY_TARGET];
  const counts = new Map<string, number>();
  for (const line of inRestoreOrder(lines)) {
    const statement = insertFor(line);
    if (!statement.ok)
      return { ok: false, why: `${statement.why}; the file does not match this schema` };
    sql.push(statement.sql);
    counts.set(line.t, (counts.get(line.t) ?? 0) + 1);
  }
  return { ok: true, header, sql, counts };
}
