// NOTE_KEK rotation (ADR 0005): `keys.rewrap` moves each live client key from NOTE_KEK_PREVIOUS to NOTE_KEK. Each
// page of keys is one batch in which every key is a compare-and-set followed by its own `keys.rewrap` event, so a
// run that stops partway leaves whole pages done and the next run starts where it stopped. The data keys, and so
// every note sealed under them, do not change; an event names the two KEKs by id and never carries a key.
import { fail } from '../lib/errors';
import { kekId, unwrapClientKey, wrapClientKey, type NoteKeks } from '../lib/note-crypto';
import { auditedBatch, retryOnce } from './audit';
import { blobBytes } from './credentials';
import type { Scope } from './scope';

/**
 * Keys per batch, and batches per run. A page costs its read, the audit head and two statements a key, so a run
 * is about 410 statements, and stays under D1's 1,000 even when every page loses a race and is sent twice.
 */
export const REWRAP_PAGE = 50;
export const REWRAP_PAGES = 4;

/** How many live client keys are wrapped under each KEK. */
export interface KeyStatus {
  current: number;
  /** Under NOTE_KEK_PREVIOUS; 0 when it is unset. */
  previous: number;
  /** Under neither, so no request can open them until their KEK is set as NOTE_KEK_PREVIOUS. */
  other: number;
}

export interface RewrapResult {
  rewrapped: number;
  status: KeyStatus;
}

const COUNTS = `SELECT kek_id, count(*) AS keys FROM client_key
GROUP BY kek_id`;

const PAGE = `SELECT client_id, version, wrapped, iv FROM client_key
WHERE kek_id = ?1 ORDER BY client_id, version LIMIT ?2`;

const MOVE = `UPDATE client_key SET wrapped = ?3, iv = ?4, kek_id = ?5
WHERE client_id = ?1 AND version = ?2 AND kek_id = ?6 AND wrapped = ?7 AND iv = ?8`;

interface KeyRow {
  client_id: string;
  version: number;
  wrapped: ArrayBuffer | number[];
  iv: ArrayBuffer | number[];
}

/** When the last key was re-wrapped, or null when none ever was. */
export async function lastRewrapAt(db: D1Database): Promise<number | null> {
  const row = await db
    .prepare("SELECT max(at) AS at FROM audit_event WHERE action = 'keys.rewrap'")
    .first<{ at: number | null }>();
  return row?.at ?? null;
}

export async function keyStatus(db: D1Database, keks: NoteKeks): Promise<KeyStatus> {
  const rows = (await db.prepare(COUNTS).all<{ kek_id: string; keys: number }>()).results;
  const current = await kekId(keks.current);
  const previous = keks.previous === null ? null : await kekId(keks.previous);
  const status: KeyStatus = { current: 0, previous: 0, other: 0 };
  for (const row of rows) {
    const kind =
      row.kek_id === current ? 'current' : row.kek_id === previous ? 'previous' : 'other';
    status[kind] += row.keys;
  }
  return status;
}

/** One page: each key opened under the previous KEK and sealed again under the current one, sent as one batch. */
async function rewrapPage(
  scope: Scope,
  db: D1Database,
  keks: { current: string; previous: string },
  previousId: string,
  size: number,
  now: number,
): Promise<number> {
  return retryOnce(async () => {
    const rows = (await db.prepare(PAGE).bind(previousId, size).all<KeyRow>()).results;
    if (rows.length === 0) return 0;
    const batch = await auditedBatch(scope, db);
    for (const row of rows) {
      const old = { wrapped: blobBytes(row.wrapped), iv: blobBytes(row.iv) };
      const dataKey = await unwrapClientKey(keks.previous, row.client_id, row.version, old).catch(
        () =>
          fail(
            'rewrap_refused',
            `the key of client ${row.client_id} does not open under NOTE_KEK_PREVIOUS`,
          ),
      );
      const next = await wrapClientKey(keks.current, row.client_id, row.version, dataKey);
      const move = db
        .prepare(MOVE)
        .bind(
          row.client_id,
          row.version,
          next.wrapped,
          next.iv,
          next.kekId,
          previousId,
          old.wrapped,
          old.iv,
        );
      const event = {
        at: now,
        action: 'keys.rewrap' as const,
        clientId: row.client_id,
        target: `client_key:${row.client_id}:${String(row.version)}`,
        before: { kek_id: previousId },
        after: { kek_id: next.kekId },
      };
      await batch.record(move, event, 1);
    }
    await batch.run();
    return rows.length;
  });
}

/**
 * Re-wraps up to `pages` pages of keys still under NOTE_KEK_PREVIOUS and returns how many moved and where every key
 * now sits. Refused, writing nothing, when NOTE_KEK_PREVIOUS is unset or is NOTE_KEK, or for anyone without the
 * `all` scope; a key that will not open under NOTE_KEK_PREVIOUS stops the run before its page is written.
 */
export async function rewrapKeys(
  scope: Scope,
  db: D1Database,
  keks: NoteKeks,
  now: number,
  limits = { page: REWRAP_PAGE, pages: REWRAP_PAGES },
): Promise<RewrapResult> {
  if (scope.kind !== 'all') fail('forbidden');
  const previous =
    keks.previous ??
    fail('rewrap_refused', 'NOTE_KEK_PREVIOUS is not set; set it to the key being retired');
  const previousId = await kekId(previous);
  if (previousId === (await kekId(keks.current))) {
    fail('rewrap_refused', 'NOTE_KEK_PREVIOUS is the same key as NOTE_KEK');
  }
  const pair = { current: keks.current, previous };
  let rewrapped = 0;
  for (let page = 0; page < limits.pages; page++) {
    const moved = await rewrapPage(scope, db, pair, previousId, limits.page, now);
    rewrapped += moved;
    if (moved < limits.page) break;
  }
  return { rewrapped, status: await keyStatus(db, keks) };
}
