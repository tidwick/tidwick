// The backup's reads: every kept table, whole, in foreign-key order. These are table dumps with no caller
// scope, run only by src/backup/export.ts. No imports, so the restore drill script can run them in Node.

/** Kept tables in the order a restore inserts them: every parent before its children. */
export const BACKUP_TABLES = [
  'client',
  'client_key',
  'firm',
  'person',
  'person_role',
  'credential',
  'person_identity',
  'enrolment',
  'recovery_code',
  'task_code',
  'project',
  'project_task',
  'assignment',
  'import_batch',
  'week_row',
  'entry',
  'week_submission',
  'setting',
  'backup_run',
  'audit_event',
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];

/** Short-lived ceremony and session state, and sign-ins under way, that a restore starts without. */
export const SKIPPED_TABLES = [
  'session',
  'auth_challenge',
  'recovery_attempt',
  'oidc_flow',
  'pending_codes',
];

/** Rows per keyset page. */
export const PAGE_ROWS = 2000;

// Table names cannot be bound, so each statement is built once from the constant list above, never from input.
const COUNT = Object.fromEntries(
  BACKUP_TABLES.map((t) => [t, `SELECT count(*) AS n FROM ${t}`]),
) as Record<BackupTable, string>;

// Each table's last rowid, read with the chain head in one batch (one transaction), caps its pages. A row
// inserted after that moment waits for the next backup, so a child written after its parent's table was dumped
// cannot reach the file without that parent. A new row takes a rowid past the table's last unless the last row
// was deleted first, which only an emptied entry or week row can be. audit_event's rowid is its seq.
const EXTENT = Object.fromEntries(
  BACKUP_TABLES.map((t) => [t, `SELECT count(*) AS n, coalesce(max(rowid), 0) AS last FROM ${t}`]),
) as Record<BackupTable, string>;

const PAGE = Object.fromEntries(
  BACKUP_TABLES.map((t) => [
    t,
    `SELECT rowid AS backup_rowid, * FROM ${t} WHERE rowid > ?1 AND rowid <= ?3 ORDER BY rowid LIMIT ?2`,
  ]),
) as Record<BackupTable, string>;

const HEAD = 'SELECT seq, hash FROM audit_event ORDER BY seq DESC LIMIT 1';

const SCHEMA_VERSION = 'SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1';

const MIGRATIONS_TABLE =
  "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'";

const GENESIS = '0'.repeat(64);

export async function countRows(db: D1Database, table: BackupTable): Promise<number> {
  return (await db.prepare(COUNT[table]).first<{ n: number }>())?.n ?? 0;
}

const ALL = Object.fromEntries(BACKUP_TABLES.map((t) => [t, `SELECT * FROM ${t}`])) as Record<
  BackupTable,
  string
>;

/** Every row of a kept table, whole, for the restore drill's content digest. */
export async function tableRows(db: D1Database, table: BackupTable): Promise<unknown[]> {
  return (await db.prepare(ALL[table]).all()).results;
}

/** The newest audit event's seq and hash, or seq 0 and the genesis hash for an empty log. */
export async function chainHead(db: D1Database): Promise<{ seq: number; hash: string }> {
  return (
    (await db.prepare(HEAD).first<{ seq: number; hash: string }>()) ?? { seq: 0, hash: GENESIS }
  );
}

export interface Snapshot {
  head: { seq: number; hash: string };
  /** Per table in `BACKUP_TABLES` order: its row count and the last rowid a page may read. */
  tables: { count: number; last: number }[];
}

/** The chain head and every table's count and last rowid, read in one batch so they describe one moment. */
export async function snapshot(db: D1Database): Promise<Snapshot> {
  const [head, ...extents] = await db.batch([
    db.prepare(HEAD),
    ...BACKUP_TABLES.map((t) => db.prepare(EXTENT[t])),
  ]);
  const top = head?.results[0] as { seq: number; hash: string } | undefined;
  return {
    head: top ?? { seq: 0, hash: GENESIS },
    tables: extents.map((r) => {
      const row = r.results[0] as { n: number; last: number } | undefined;
      return { count: row?.n ?? 0, last: row?.last ?? 0 };
    }),
  };
}

/** The last migration applied, as the migrations table names it; null where migrations ran without one. */
export async function schemaVersion(db: D1Database): Promise<string | null> {
  if ((await db.prepare(MIGRATIONS_TABLE).first()) === null) return null;
  return (await db.prepare(SCHEMA_VERSION).first<{ name: string }>())?.name ?? null;
}

/** One keyset page after `after` and up to `last` (rowids); returns the rows without the page key and the next key. */
export async function readPage(
  db: D1Database,
  table: BackupTable,
  after: number,
  last: number,
): Promise<{ rows: Record<string, unknown>[]; next: number }> {
  const results = (await db.prepare(PAGE[table]).bind(after, PAGE_ROWS, last).all()).results;
  let next = after;
  const rows = results.map(({ backup_rowid, ...row }) => {
    next = Number(backup_rowid);
    return row;
  });
  return { rows, next };
}
