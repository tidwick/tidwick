// Saving cells of one person's own week. The rules are enforced here and again by the schema: a day passes 24
// hours only by failing the `entry` trigger, a locked week writes nothing because every statement carries the
// lock predicate, and a row outside the scope or on a project its owner is no longer assigned to writes nothing,
// whatever grants the caller holds, because every statement carries the assignment predicate too (SEC-12). An
// owner's own edits to an unlocked week are not audited.
import { fail } from '../lib/errors';
import { DAY_CAP } from '../lib/hours';
import { newId } from '../lib/ids';
import { sealNote, type NoteKeks } from '../lib/note-crypto';
import { DAY_NAMES, DAYS_IN_WEEK, isBlank, isEditable, type Cell } from '../lib/week';
import type { CellEdit } from '../lib/week-form';
import { retryOnce } from './audit';
import { keyRing, type KeyRing } from './client-keys';
import type { Scope } from './scope';
import { openCell, readCells, readRows, weekState, type CellRecord } from './week-view';

/** One cell's change, planned: the statement that makes it. */
interface Planned {
  rowId: string;
  statement: D1PreparedStatement;
  /** Hours added to the day. The batch applies the most negative first, so no step passes the cap. */
  delta: number;
  /** An insert or update changes one row; zero means the lock predicate refused it. */
  writes: boolean;
}

/** SQL true unless the person has submitted, or had approved, the week of the week row `rowId` names. */
export const WEEK_OPEN = (rowId: string): string => `NOT EXISTS (
  SELECT 1 FROM week_submission s JOIN week_row w ON w.person_id = s.person_id AND w.week_start = s.week_start
  WHERE w.id = ${rowId} AND s.state IN ('submitted', 'approved'))`;

/** SQL true while the person whose week row `rowId` names is still assigned to that row's project. */
export const ROW_ASSIGNED = (rowId: string): string => `EXISTS (
  SELECT 1 FROM week_row w JOIN assignment a
    ON a.person_id = w.person_id AND a.client_id = w.client_id AND a.project_id = w.project_id
  WHERE w.id = ${rowId})`;

const UNASSIGNED = `SELECT r.id FROM week_row r WHERE r.person_id = ?1 AND r.week_start = ?2 AND NOT ${ROW_ASSIGNED('r.id')}`;

const INSERT = `INSERT INTO entry (id, client_id, row_id, dow, hundredths, note_ct, note_iv, key_version, updated_at)
SELECT ?1, r.client_id, r.id, ?2, ?3, ?4, ?5, ?6, ?7 FROM week_row r
WHERE r.id = ?8 AND r.person_id = ?9 AND ${WEEK_OPEN('r.id')} AND ${ROW_ASSIGNED('r.id')}`;

const UPDATE = `UPDATE entry SET hundredths = ?2, note_ct = ?3, note_iv = ?4, key_version = ?5, updated_at = ?6
WHERE id = ?1 AND row_id = ?7 AND ${WEEK_OPEN('entry.row_id')} AND ${ROW_ASSIGNED('entry.row_id')}`;

const DELETE = `DELETE FROM entry
WHERE id = ?1 AND row_id = ?2 AND ${WEEK_OPEN('entry.row_id')} AND ${ROW_ASSIGNED('entry.row_id')}`;

const DAY_SUMS = `SELECT e.dow, sum(e.hundredths) AS total
FROM entry e JOIN week_row r ON r.client_id = e.client_id AND r.id = e.row_id
WHERE r.person_id = ?1 AND r.week_start = ?2 GROUP BY e.dow`;

/** Day totals of the person's whole week, rows outside the scope included, so the cap counts every hour. */
export async function bookedByDay(
  db: D1Database,
  personId: string,
  weekStart: string,
): Promise<number[]> {
  const sums = Array.from({ length: DAYS_IN_WEEK }, () => 0);
  const found = await db
    .prepare(DAY_SUMS)
    .bind(personId, weekStart)
    .all<{ dow: number; total: number }>();
  for (const { dow, total } of found.results) sums[dow] = total;
  return sums;
}

/** The statement that brings one stored cell (or none) to the edit, or null when nothing would change. */
async function planCell(
  db: D1Database,
  ring: KeyRing,
  clientId: string,
  personId: string,
  edit: CellEdit,
  before: CellRecord | undefined,
  now: number,
): Promise<Planned | null> {
  const next: Cell = { hundredths: edit.hundredths, note: edit.note };
  if (before === undefined && isBlank(next)) return null;
  if (before !== undefined) {
    const current = await openCell(before, ring);
    if (current.hundredths === next.hundredths && current.note === next.note) return null;
    const delta = next.hundredths - before.hundredths;
    const shown = { rowId: edit.rowId, delta };
    if (isBlank(next)) {
      const statement = db.prepare(DELETE).bind(before.id, edit.rowId);
      return { ...shown, statement, writes: false };
    }
    const sealed = await seal(ring, clientId, before.id, next.note);
    const statement = db
      .prepare(UPDATE)
      .bind(before.id, next.hundredths, ...sealed, now, edit.rowId);
    return { ...shown, statement, writes: true };
  }
  const id = newId();
  const sealed = await seal(ring, clientId, id, next.note);
  const statement = db
    .prepare(INSERT)
    .bind(id, edit.dow, next.hundredths, ...sealed, now, edit.rowId, personId);
  return { rowId: edit.rowId, statement, delta: next.hundredths, writes: true };
}

/** The person's rows in the week whose project they are no longer assigned to. */
export async function unassignedRows(
  db: D1Database,
  personId: string,
  weekStart: string,
): Promise<Set<string>> {
  const found = await db.prepare(UNASSIGNED).bind(personId, weekStart).all<{ id: string }>();
  return new Set(found.results.map((r) => r.id));
}

/** Refuses edits to a row whose project the person is no longer assigned to, whatever the caller's grants. */
export async function requireAssigned(
  db: D1Database,
  personId: string,
  weekStart: string,
  rowIds: readonly string[],
): Promise<void> {
  const off = await unassignedRows(db, personId, weekStart);
  if (rowIds.some((id) => off.has(id))) fail('forbidden', 'that project is no longer assigned');
}

/** The note's ciphertext, iv and key version for binding, or three nulls for no note. */
export async function seal(
  ring: KeyRing,
  clientId: string,
  entryId: string,
  note: string,
): Promise<[Uint8Array | null, Uint8Array | null, number | null]> {
  if (note === '') return [null, null, null];
  const key = (await ring.current(clientId)) ?? fail('no_client_key');
  const sealed = await sealNote(key.key, clientId, entryId, note);
  return [sealed.ct, sealed.iv, key.version];
}

/** Saves the edited cells of the scope's own week, all or none. Zero hours with no note removes the entry. */
export async function saveCells(
  scope: Scope,
  db: D1Database,
  keks: NoteKeks,
  weekStart: string,
  edits: readonly CellEdit[],
  now: number,
): Promise<void> {
  const personId = scope.actorId ?? fail('forbidden');
  await retryOnce(async () => {
    const rows = new Map(
      (await readRows(scope, db, personId, weekStart)).map((r) => [r.row_id, r]),
    );
    const outside = edits.find((edit) => !rows.has(edit.rowId));
    if (outside) fail('forbidden', 'that row is not yours to edit');
    await requireAssigned(
      db,
      personId,
      weekStart,
      edits.map((edit) => edit.rowId),
    );
    if (!isEditable(await weekState(scope, db, personId, weekStart))) fail('locked');
    const ring = keyRing(db, keks);
    const stored = new Map<string, CellRecord>();
    for (const record of await readCells(scope, db, personId, weekStart)) {
      stored.set(`${record.row_id}|${String(record.dow)}`, record);
    }
    const days = await bookedByDay(db, personId, weekStart);
    const planned: Planned[] = [];
    for (const edit of edits) {
      const clientId = rows.get(edit.rowId)?.client_id ?? fail('forbidden');
      const before = stored.get(`${edit.rowId}|${String(edit.dow)}`);
      const plan = await planCell(db, ring, clientId, personId, edit, before, now);
      if (plan === null) continue;
      days[edit.dow] = (days[edit.dow] ?? 0) + plan.delta;
      planned.push(plan);
    }
    const over = days.findIndex((total) => total > DAY_CAP);
    if (over >= 0) fail('day_cap', DAY_NAMES[over]);
    planned.sort((a, b) => a.delta - b.delta);
    await apply(scope, db, personId, weekStart, planned);
  });
}

/**
 * Sends the batch; a write the predicates refused is `forbidden` when its row's project was unassigned since the
 * read, else `locked` or `conflict`, and the trigger's cap is `day_cap`.
 */
async function apply(
  scope: Scope,
  db: D1Database,
  personId: string,
  weekStart: string,
  planned: readonly Planned[],
): Promise<void> {
  if (planned.length === 0) return;
  let results: D1Result[];
  try {
    results = await db.batch(planned.map((p) => p.statement));
  } catch (error) {
    if (error instanceof Error && error.message.includes('day_cap')) fail('day_cap');
    throw error;
  }
  if (!results.some((result, i) => planned[i]?.writes === true && result.meta.changes === 0))
    return;
  await requireAssigned(
    db,
    personId,
    weekStart,
    planned.map((p) => p.rowId),
  );
  fail(isEditable(await weekState(scope, db, personId, weekStart)) ? 'conflict' : 'locked');
}
