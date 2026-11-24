// Test and drill support for the backup, never imported by production code: synthetic audit events and client
// keys for a source database, settings, the table list, and a tamper. Relative imports carry `.ts` so the drill
// scripts run it in Node.
import { eventHash, GENESIS } from '../lib/chain.ts';
import { newClientKey } from '../lib/note-crypto.ts';

const TABLES = `SELECT name FROM sqlite_master WHERE type = 'table'
  AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations' ORDER BY name`;

const HEAD = 'SELECT seq, hash FROM audit_event ORDER BY seq DESC LIMIT 1';

const EVENT = `INSERT INTO audit_event
  (seq, at, actor_id, action, client_id, target, before_json, after_json, prev_hash, hash)
VALUES (?1, ?2, NULL, ?3, NULL, ?4, NULL, ?5, ?6, ?7)`;

const CLIENTS_WITHOUT_KEY = `SELECT id FROM client c
WHERE NOT EXISTS (SELECT 1 FROM client_key k WHERE k.client_id = c.id) ORDER BY id`;

const KEY = `INSERT INTO client_key (client_id, version, wrapped, iv, kek_id, created_at)
VALUES (?1, 1, ?2, ?3, ?4, ?5)`;

const SETTING = `INSERT INTO setting (key, value_json) VALUES (?1, ?2)
ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`;

const LATE_ROW = `INSERT INTO week_row (id, client_id, person_id, week_start, project_id, task_code_id, position)
SELECT ?1, client_id, person_id, '2026-02-02', project_id, task_code_id, 0 FROM week_row LIMIT 1`;

const LATE_ENTRY = `INSERT INTO entry (id, client_id, row_id, dow, hundredths, updated_at)
SELECT ?2, client_id, id, 0, 100, 1 FROM week_row WHERE id = ?1`;

const RUNS = 'SELECT status, object_key, error FROM backup_run ORDER BY started_at, rowid';

/** Every table the migrations made, by name. */
export async function tableNames(db: D1Database): Promise<string[]> {
  return (await db.prepare(TABLES).all<{ name: string }>()).results.map((r) => r.name);
}

/**
 * Appends `count` linked synthetic events after the current head, with null actors and clients. `filler`, when
 * given, is carried in each event's `after_json` so a test can make the log wide.
 */
export async function appendSyntheticEvents(
  db: D1Database,
  count: number,
  at: number,
  filler?: string,
): Promise<void> {
  let head = (await db.prepare(HEAD).first<{ seq: number; hash: string }>()) ?? {
    seq: 0,
    hash: GENESIS,
  };
  let pending: D1PreparedStatement[] = [];
  for (let i = 0; i < count; i++) {
    const event = {
      seq: head.seq + 1,
      at: at + i,
      actor_id: null,
      action: 'drill.event',
      client_id: null,
      target: `drill:${String(head.seq + 1)}`,
      before_json: null,
      after_json: JSON.stringify(filler === undefined ? { n: i } : { n: i, filler }),
    };
    const hash = await eventHash(head.hash, event);
    pending.push(
      db
        .prepare(EVENT)
        .bind(event.seq, event.at, event.action, event.target, event.after_json, head.hash, hash),
    );
    head = { seq: event.seq, hash };
    if (pending.length === 500 || i === count - 1) {
      await db.batch(pending);
      pending = [];
    }
  }
}

/** Gives every client with no data key its first one, wrapped under `kek`, so the source holds BLOBs. */
export async function keyEveryClient(db: D1Database, kek: string, at: number): Promise<void> {
  const ids = (await db.prepare(CLIENTS_WITHOUT_KEY).all<{ id: string }>()).results;
  for (const { id } of ids) {
    const key = await newClientKey(kek, id, 1);
    await db.prepare(KEY).bind(id, key.wrapped, key.iv, key.kekId, at).run();
  }
}

export async function putSetting(db: D1Database, key: string, value: unknown): Promise<void> {
  await db.prepare(SETTING).bind(key, JSON.stringify(value)).run();
}

export async function backupRuns(
  db: D1Database,
): Promise<{ status: string; object_key: string; error: string | null }[]> {
  return (
    await db.prepare(RUNS).all<{ status: string; object_key: string; error: string | null }>()
  ).results;
}

/** Rewrites one event's target with the update trigger dropped, as someone with database access could. */
export async function tamperTarget(db: D1Database, seq: number, target: string): Promise<void> {
  await db.batch([
    db.prepare('DROP TRIGGER audit_no_update'),
    db.prepare('UPDATE audit_event SET target = ?2 WHERE seq = ?1').bind(seq, target),
    db.prepare(
      "CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_event BEGIN SELECT RAISE(ABORT, 'audit_append_only'); END",
    ),
  ]);
}

/** A new week row and its one entry, as a person saving a new week mid-backup writes them. */
export async function writeLateRow(db: D1Database, rowId: string, entryId: string): Promise<void> {
  await db.batch([db.prepare(LATE_ROW).bind(rowId), db.prepare(LATE_ENTRY).bind(rowId, entryId)]);
}

const RUN_CHARS = 'SELECT chars FROM backup_run WHERE status = ?1';
const SET_CHARS = "UPDATE backup_run SET chars = ?1 WHERE status = 'ok'";

/** The characters the one run of this status recorded, or -1 when there is none. */
export async function runChars(db: D1Database, status: 'ok' | 'failed'): Promise<number> {
  return (await db.prepare(RUN_CHARS).bind(status).first<{ chars: number }>())?.chars ?? -1;
}

/** Overwrites the characters every good run recorded, as a dump of that size would have. */
export async function setGoodRunChars(db: D1Database, chars: number): Promise<void> {
  await db.prepare(SET_CHARS).bind(chars).run();
}
