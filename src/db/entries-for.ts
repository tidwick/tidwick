// An accounting admin's edits to another person's week, in any state and so through the lock. Each changed cell is
// a compare-and-set on the hours and note ciphertext it read, followed in the same batch by one audit event with
// those values before and after; a write landing in between makes the batch roll back with no event, and it is
// tried once more on a fresh read (DESIGN: Submit, approve, lock).
import { fail } from '../lib/errors';
import { DAY_CAP } from '../lib/hours';
import type { NoteKeks } from '../lib/note-crypto';
import { newId } from '../lib/ids';
import { DAY_NAMES, isBlank, type Cell } from '../lib/week';
import type { CellEdit } from '../lib/week-form';
import { auditedBatch, retryOnce, type AuditInput } from './audit';
import { keyRing, type KeyRing } from './client-keys';
import { blobBytes } from './credentials';
import { bookedByDay, requireAssigned, ROW_ASSIGNED, seal } from './entry-writes';
import type { Scope } from './scope';
import { openCell, readCells, readRows, type CellRecord } from './week-view';

const INSERT = `INSERT INTO entry (id, client_id, row_id, dow, hundredths, note_ct, note_iv, key_version, updated_at)
SELECT ?1, r.client_id, r.id, ?2, ?3, ?4, ?5, ?6, ?7 FROM week_row r
WHERE r.id = ?8 AND r.person_id = ?9 AND ${ROW_ASSIGNED('r.id')}`;

const UPDATE = `UPDATE entry SET hundredths = ?2, note_ct = ?3, note_iv = ?4, key_version = ?5, updated_at = ?6
WHERE id = ?1 AND row_id = ?7 AND hundredths = ?8 AND note_ct IS ?9 AND ${ROW_ASSIGNED('entry.row_id')}`;

const DELETE = `DELETE FROM entry
WHERE id = ?1 AND row_id = ?2 AND hundredths = ?3 AND note_ct IS ?4 AND ${ROW_ASSIGNED('entry.row_id')}`;

/** What the audit event records of a cell: its hours and its note's ciphertext as hex, never the note. */
interface Stored {
  hundredths: number;
  note_ct: string | null;
}

interface Planned {
  statement: D1PreparedStatement;
  delta: number;
  event: AuditInput;
}

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

function stored(hundredths: number, ct: Uint8Array | null): Stored {
  return { hundredths, note_ct: ct === null ? null : hex(ct) };
}

async function planCell(
  db: D1Database,
  ring: KeyRing,
  target: { clientId: string; personId: string },
  edit: CellEdit,
  before: CellRecord | undefined,
  now: number,
): Promise<Planned | null> {
  const next: Cell = { hundredths: edit.hundredths, note: edit.note };
  const { clientId, personId } = target;
  const event = (entryId: string, was: Stored | null, will: Stored | null): AuditInput => ({
    at: now,
    action: 'entriesFor.save',
    clientId,
    target: `entry:${entryId}`,
    before: was,
    after: will,
  });
  if (before === undefined) {
    if (isBlank(next)) return null;
    const id = newId();
    const sealed = await seal(ring, clientId, id, next.note);
    const statement = db
      .prepare(INSERT)
      .bind(id, edit.dow, next.hundredths, ...sealed, now, edit.rowId, personId);
    return {
      statement,
      delta: next.hundredths,
      event: event(id, null, stored(next.hundredths, sealed[0])),
    };
  }
  const current = await openCell(before, ring);
  if (current.hundredths === next.hundredths && current.note === next.note) return null;
  const ct = before.note_ct === null ? null : blobBytes(before.note_ct);
  const was = stored(before.hundredths, ct);
  const delta = next.hundredths - before.hundredths;
  if (isBlank(next)) {
    const statement = db.prepare(DELETE).bind(before.id, edit.rowId, before.hundredths, ct);
    return { statement, delta, event: event(before.id, was, null) };
  }
  const sealed = await seal(ring, clientId, before.id, next.note);
  const statement = db
    .prepare(UPDATE)
    .bind(before.id, next.hundredths, ...sealed, now, edit.rowId, before.hundredths, ct);
  return { statement, delta, event: event(before.id, was, stored(next.hundredths, sealed[0])) };
}

/**
 * Saves edited cells of `personId`'s week whatever its state, all or none, each audited with before and after.
 * Rows must be in that week (else `not_found`) and on projects the person is still assigned to (else `forbidden`).
 */
export async function saveCellsFor(
  scope: Scope,
  db: D1Database,
  keks: NoteKeks,
  personId: string,
  weekStart: string,
  edits: readonly CellEdit[],
  now: number,
): Promise<void> {
  if (scope.kind !== 'all' || scope.actorId === null) fail('forbidden');
  await retryOnce(async () => {
    const rows = new Map(
      (await readRows(scope, db, personId, weekStart)).map((r) => [r.row_id, r]),
    );
    if (edits.some((edit) => !rows.has(edit.rowId)))
      fail('not_found', 'that row is not in this week');
    await requireAssigned(
      db,
      personId,
      weekStart,
      edits.map((edit) => edit.rowId),
    );
    const ring = keyRing(db, keks);
    const cells = new Map<string, CellRecord>();
    for (const record of await readCells(scope, db, personId, weekStart)) {
      cells.set(`${record.row_id}|${String(record.dow)}`, record);
    }
    const days = await bookedByDay(db, personId, weekStart);
    const planned: Planned[] = [];
    for (const edit of edits) {
      const clientId = rows.get(edit.rowId)?.client_id ?? fail('not_found');
      const before = cells.get(`${edit.rowId}|${String(edit.dow)}`);
      const plan = await planCell(db, ring, { clientId, personId }, edit, before, now);
      if (plan === null) continue;
      days[edit.dow] = (days[edit.dow] ?? 0) + plan.delta;
      planned.push(plan);
    }
    const over = days.findIndex((total) => total > DAY_CAP);
    if (over >= 0) fail('day_cap', DAY_NAMES[over]);
    if (planned.length === 0) return;
    planned.sort((a, b) => a.delta - b.delta);
    const batch = await auditedBatch(scope, db);
    for (const p of planned) await batch.record(p.statement, p.event, 1);
    try {
      await batch.run();
    } catch (error) {
      if (error instanceof Error && error.message.includes('day_cap')) fail('day_cap');
      throw error;
    }
  });
}
