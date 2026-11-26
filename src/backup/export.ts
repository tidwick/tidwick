// The 03:00 backup: every kept table as NDJSON after a header, gzipped, encrypted with age to the adopter's
// public key, written to the sink and to the off-account copy. Relative imports carry `.ts` so the restore drill
// script runs it in Node. The same holds for every file the scripts import (backup/export, s3-copy, sigv4,
// backup-runs, restore, rescue, db/backup-rows, lib/backup-format, chain, limits, note-crypto): relative `.ts`
// imports, and never `cloudflare:*` or `astro:*` modules.
import { Encrypter } from 'age-encryption';
import {
  BACKUP_TABLES,
  PAGE_ROWS,
  readPage,
  schemaVersion,
  snapshot,
  type Snapshot,
} from '../db/backup-rows.ts';
import { recordRun, type BackupRun } from '../db/backup-runs.ts';
import { errorText } from '../lib/error-text.ts';
import { isAgeRecipient } from '../lib/secrets.ts';
import { withRetry } from './retry.ts';
import { encodeLine, FORMAT, VERSION, type BackupHeader } from '../lib/backup-format.ts';
import { BACKUP_DUMP_CHARS, D1_QUERIES_PER_INVOCATION } from '../lib/limits.ts';

/** Where the backup goes: the `BACKUPS` R2 binding, or anything with the same `put`. */
export interface BackupSink {
  put(key: string, value: Uint8Array): Promise<unknown>;
}

/** The second, off-account copy: writes the sealed file and answers null, or why it did not land. */
export interface BackupCopy {
  write(key: string, value: Uint8Array): Promise<string | null>;
}

export interface BackupDeps {
  db: D1Database;
  sink: BackupSink;
  recipient: string;
  /** The off-account copy; absent or null when `BACKUP_COPY` is `none`. */
  copy?: BackupCopy | null;
  /** Milliseconds before a write's second try (and twice that before its third); tests pass 0. */
  retryPauseMs?: number;
}

/** `backups/YYYY/MM/DD-HHMMSS.ndjson.gz.age` for the UTC time of `now`, so a second backup the same day keeps both. */
export function objectKey(now: number): string {
  const [date = '', time = ''] = new Date(now).toISOString().slice(0, 19).split('T');
  const [y = '', m = '', d = ''] = date.split('-');
  return `backups/${y}/${m}/${d}-${time.replaceAll(':', '')}.ndjson.gz.age`;
}

/**
 * Statements a run needs for these row counts: the schema version (two), the head and one count per table (one
 * batch),
 * one keyset page per started 2,000 rows plus the empty page that ends each table, and the run record.
 */
export function plannedQueries(counts: readonly number[]): number {
  const pages = counts.reduce((sum, n) => sum + Math.floor(n / PAGE_ROWS) + 1, 0);
  return 2 + 1 + counts.length + pages + 1;
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The dump as one string, or the table it was reading when it passed `cap` characters. */
async function ndjson(
  db: D1Database,
  header: BackupHeader,
  taken: Snapshot,
  cap: number,
): Promise<{ text: string } | { over: string }> {
  const lines = [JSON.stringify(header)];
  let chars = (lines[0]?.length ?? 0) + 1;
  for (const [i, table] of BACKUP_TABLES.entries()) {
    const last = taken.tables[i]?.last ?? 0;
    let after = 0;
    for (;;) {
      const page = await readPage(db, table, after, last);
      for (const row of page.rows) {
        const line = encodeLine(table, row);
        chars += line.length + 1;
        if (chars > cap) return { over: table };
        lines.push(line);
      }
      if (page.rows.length < PAGE_ROWS) break;
      after = page.next;
    }
  }
  return { text: `${lines.join('\n')}\n` };
}

/** The limits one run is held to: D1 statements, and characters of NDJSON built in memory. */
export interface BackupLimits {
  queries: number;
  chars: number;
}

const LIMITS: BackupLimits = { queries: D1_QUERIES_PER_INVOCATION, chars: BACKUP_DUMP_CHARS };

/** Writes the file and marks `run` ok, or returns why it did not, naming the step that failed. */
async function attempt(
  deps: BackupDeps,
  run: BackupRun,
  limits: BackupLimits,
): Promise<string | null> {
  if (!isAgeRecipient(deps.recipient)) {
    return 'missing_binding: BACKUP_RECIPIENT is not an age public key; set it from the offline kit';
  }
  let step = 'reading the schema version';
  try {
    const schema = await schemaVersion(deps.db);
    step = 'reading the snapshot';
    const taken = await snapshot(deps.db);
    run.chain_seq = taken.head.seq;
    run.chain_head = taken.head.hash;
    const planned = plannedQueries(taken.tables.map((t) => t.count));
    if (planned > limits.queries) {
      return `query budget: ${String(planned)} statements needed, ${String(limits.queries)} allowed`;
    }
    const header: BackupHeader = {
      format: FORMAT,
      version: VERSION,
      schema_version: schema,
      created_at: run.started_at,
      chain_seq: taken.head.seq,
      chain_head: taken.head.hash,
    };
    step = 'dumping the tables';
    const dump = await ndjson(deps.db, header, taken, limits.chars);
    if ('over' in dump) {
      return `size budget: the dump passed ${String(limits.chars)} characters while reading ${dump.over}`;
    }
    run.chars = dump.text.length;
    step = 'encrypting';
    const encrypter = new Encrypter();
    encrypter.addRecipient(deps.recipient);
    const sealed = await encrypter.encrypt(await gzip(dump.text));
    run.bytes = sealed.byteLength;
    return await write(deps, run, sealed);
  } catch (error) {
    return `${step} failed: ${errorText(error)}`;
  }
}

/**
 * Puts the sealed file in the sink, then in the off-account copy, each tried up to three times whatever the other did, and marks
 * `run` ok only when every write landed; otherwise returns each failure's reason.
 */
async function write(deps: BackupDeps, run: BackupRun, sealed: Uint8Array): Promise<string | null> {
  const failures: string[] = [];
  const sunk = await withRetry(async () => {
    await deps.sink.put(run.object_key, sealed);
    return null;
  }, deps.retryPauseMs);
  if (sunk !== null) failures.push(`writing to the sink failed: ${sunk}`);
  const { copy } = deps;
  if (copy) {
    const why = await withRetry(() => copy.write(run.object_key, sealed), deps.retryPauseMs);
    if (why !== null) failures.push(`copying off the account failed: ${why}`);
  }
  if (failures.length > 0) return failures.join('; ');
  run.status = 'ok';
  return null;
}

/**
 * Writes one backup and records the run. A run the query or size budget would not cover, one without a valid
 * recipient, or one that fails before the file is sealed, records `failed` with the reason and leaves no object,
 * so a partial file is never written. A sealed file goes to the sink and the off-account copy; the run is `ok`
 * only when both landed, and a failed write is recorded with its reason while the other copy stays. `limits`
 * overrides either budget in tests.
 */
export async function runBackup(
  deps: BackupDeps,
  now: number,
  limits: Partial<BackupLimits> = {},
): Promise<BackupRun> {
  const wall = Date.now();
  const run: BackupRun = {
    id: crypto.randomUUID(),
    started_at: now,
    finished_at: now,
    object_key: objectKey(now),
    bytes: 0,
    chars: 0,
    chain_seq: 0,
    chain_head: '0'.repeat(64),
    status: 'failed',
    error: null,
  };
  run.error = await attempt(deps, run, { ...LIMITS, ...limits });
  run.finished_at = now + Math.max(0, Date.now() - wall);
  await recordRun(deps.db, run);
  return run;
}
