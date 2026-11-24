// One row per backup attempt, good or failed, and the newest good one that /healthz and the 09:00 check read.
// No imports, so the restore drill script can record a run in Node.

export interface BackupRun {
  id: string;
  started_at: number;
  finished_at: number;
  object_key: string;
  bytes: number;
  /** Characters of NDJSON the run built; 0 when it failed before the dump was whole. */
  chars: number;
  chain_seq: number;
  chain_head: string;
  status: 'ok' | 'failed';
  error: string | null;
}

const INSERT = `INSERT INTO backup_run
  (id, started_at, finished_at, object_key, bytes, chain_seq, chain_head, status, error, chars)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`;

const LATEST_GOOD = `SELECT id, started_at, finished_at, object_key, bytes, chars, chain_seq, chain_head, status, error
FROM backup_run WHERE status = 'ok' ORDER BY finished_at DESC LIMIT 1`;

const LATEST = `SELECT status, finished_at, error FROM backup_run ORDER BY finished_at DESC LIMIT 1`;

export async function recordRun(db: D1Database, run: BackupRun): Promise<void> {
  await db
    .prepare(INSERT)
    .bind(
      run.id,
      run.started_at,
      run.finished_at,
      run.object_key,
      run.bytes,
      run.chain_seq,
      run.chain_head,
      run.status,
      run.error,
      run.chars,
    )
    .run();
}

export async function latestGoodRun(db: D1Database): Promise<BackupRun | null> {
  return db.prepare(LATEST_GOOD).first<BackupRun>();
}

/** The newest run of either status, so the 09:00 check can name why the last one failed. */
export async function latestRun(
  db: D1Database,
): Promise<Pick<BackupRun, 'status' | 'finished_at' | 'error'> | null> {
  return db.prepare(LATEST).first<Pick<BackupRun, 'status' | 'finished_at' | 'error'>>();
}
