// A person's week as the grid shows it: rows with labels, seven cells each with notes decrypted, the lock state,
// and the projects and tasks they may add. Reads go through the scope; a member sees only assigned projects.
import { fail } from '../lib/errors';
import { fingerprintText } from '../lib/fingerprint';
import { openNote, type NoteKeks } from '../lib/note-crypto';
import {
  DAYS_IN_WEEK,
  type Cell,
  type GridRow,
  type LoadedWeek,
  type ProjectOption,
  type WeekState,
} from '../lib/week';
import { keyRing, type KeyRing } from './client-keys';
import { blobBytes } from './credentials';
import { projectsParam, requirePersonVisible, type Scope } from './scope';
import { weekFingerprint } from './week-print';

export interface RowRecord {
  row_id: string;
  client_id: string;
  project_id: string;
  task_code_id: string;
  client: string;
  project: string;
  task_code: string;
  task: string;
}

export interface CellRecord {
  id: string;
  row_id: string;
  client_id: string;
  dow: number;
  hundredths: number;
  note_ct: ArrayBuffer | number[] | null;
  note_iv: ArrayBuffer | number[] | null;
  key_version: number | null;
}

const IN_SCOPE = 'AND (?3 IS NULL OR r.project_id IN (SELECT value FROM json_each(?3)))';

const ROWS = `SELECT r.id AS row_id, r.client_id, r.project_id, r.task_code_id, c.name AS client, p.name AS project,
  t.code AS task_code, t.name AS task
FROM week_row r
JOIN client c ON c.id = r.client_id
JOIN project p ON p.client_id = r.client_id AND p.id = r.project_id
JOIN task_code t ON t.id = r.task_code_id
WHERE r.person_id = ?1 AND r.week_start = ?2 ${IN_SCOPE}
ORDER BY r.position, r.id`;

const CELLS = `SELECT e.id, e.row_id, e.client_id, e.dow, e.hundredths, e.note_ct, e.note_iv, e.key_version
FROM entry e JOIN week_row r ON r.client_id = e.client_id AND r.id = e.row_id
WHERE r.person_id = ?1 AND r.week_start = ?2 ${IN_SCOPE}`;

const STATE = 'SELECT state FROM week_submission WHERE person_id = ?1 AND week_start = ?2';

const OPTION_COLUMNS = `SELECT p.id AS project_id, c.name AS client, p.name AS project,
  t.id AS task_code_id, t.code, t.name`;
const OPTION_JOINS = `JOIN client c ON c.id = p.client_id
JOIN project_task pt ON pt.client_id = p.client_id AND pt.project_id = p.id AND pt.archived_at IS NULL
JOIN task_code t ON t.id = pt.task_code_id AND t.archived_at IS NULL`;
const OPTION_ORDER = 'ORDER BY c.name, p.name, t.code';

const ASSIGNED_OPTIONS = `${OPTION_COLUMNS}
FROM assignment a JOIN project p ON p.client_id = a.client_id AND p.id = a.project_id
${OPTION_JOINS}
WHERE a.person_id = ?1 AND p.archived_at IS NULL AND c.archived_at IS NULL
${OPTION_ORDER}`;

const LIVE_OPTIONS = `${OPTION_COLUMNS}
FROM project p
${OPTION_JOINS}
WHERE p.archived_at IS NULL AND c.archived_at IS NULL
${OPTION_ORDER}`;

/** The week's lock state: no submission row means draft. */
export async function weekState(
  scope: Scope,
  db: D1Database,
  personId: string,
  weekStart: string,
): Promise<WeekState> {
  requirePersonVisible(scope, personId);
  const row = await db.prepare(STATE).bind(personId, weekStart).first<{ state: WeekState }>();
  return row?.state ?? 'draft';
}

/**
 * One person's week with every note decrypted. A member asking for another person's week gets `not_found`;
 * a row on a project outside the scope is left out. A note whose client key was destroyed reads as empty.
 */
export async function loadWeek(
  scope: Scope,
  db: D1Database,
  keks: NoteKeks,
  personId: string,
  weekStart: string,
): Promise<LoadedWeek> {
  requirePersonVisible(scope, personId);
  const [rows, cells, state, print] = await Promise.all([
    readRows(scope, db, personId, weekStart),
    readCells(scope, db, personId, weekStart),
    weekState(scope, db, personId, weekStart),
    weekFingerprint(scope, db, personId, weekStart),
  ]);
  const ring = keyRing(db, keks);
  const stored = new Map<string, Cell[]>();
  const present = new Set<string>();
  for (const record of cells) {
    const cell = await openCell(record, ring);
    const row = stored.get(record.row_id) ?? blankCells();
    row[record.dow] = cell;
    stored.set(record.row_id, row);
    present.add(record.row_id);
  }
  const grid: GridRow[] = rows.map((r) => ({
    rowId: r.row_id,
    client: r.client,
    project: r.project,
    projectId: r.project_id,
    taskCode: r.task_code,
    task: r.task,
    removable: !present.has(r.row_id),
    cells: stored.get(r.row_id) ?? blankCells(),
  }));
  return { weekStart, state, rows: grid, fingerprint: fingerprintText(print) };
}

export const blankCells = (): Cell[] =>
  Array.from({ length: DAYS_IN_WEEK }, () => ({ hundredths: 0, note: '' }));

/** The person's week rows on projects the scope may see, in grid order. */
export async function readRows(
  scope: Scope,
  db: D1Database,
  personId: string,
  weekStart: string,
): Promise<RowRecord[]> {
  requirePersonVisible(scope, personId);
  const result = await db
    .prepare(ROWS)
    .bind(personId, weekStart, projectsParam(scope))
    .all<RowRecord>();
  return result.results;
}

/** The stored entries of those rows, notes still sealed. */
export async function readCells(
  scope: Scope,
  db: D1Database,
  personId: string,
  weekStart: string,
): Promise<CellRecord[]> {
  requirePersonVisible(scope, personId);
  const result = await db
    .prepare(CELLS)
    .bind(personId, weekStart, projectsParam(scope))
    .all<CellRecord>();
  return result.results;
}

/** A stored entry as a cell, its note opened under the client key it was sealed with. */
export async function openCell(record: CellRecord, ring: KeyRing): Promise<Cell> {
  if (record.note_ct === null || record.note_iv === null || record.key_version === null) {
    return { hundredths: record.hundredths, note: '' };
  }
  const key = await ring.version(record.client_id, record.key_version);
  if (key === null) return { hundredths: record.hundredths, note: '' };
  const note = await openNote(key, record.client_id, record.id, {
    ct: blobBytes(record.note_ct),
    iv: blobBytes(record.note_iv),
  });
  return { hundredths: record.hundredths, note };
}

interface OptionRecord {
  project_id: string;
  client: string;
  project: string;
  task_code_id: string;
  code: string;
  name: string;
}

/**
 * The unarchived projects and the live tasks each allows that the grid's add-row offers: the person's assigned
 * projects, or every live project for an all-clients scope, whose pick assigns them (`addRow`).
 */
export async function addRowOptions(
  scope: Scope,
  db: D1Database,
  personId: string,
): Promise<ProjectOption[]> {
  requirePersonVisible(scope, personId);
  if (scope.kind === 'ceremony') fail('not_found');
  const found = (
    await (
      scope.kind === 'all' ? db.prepare(LIVE_OPTIONS) : db.prepare(ASSIGNED_OPTIONS).bind(personId)
    ).all<OptionRecord>()
  ).results;
  const options = new Map<string, ProjectOption>();
  for (const r of found) {
    const option = options.get(r.project_id) ?? {
      projectId: r.project_id,
      client: r.client,
      project: r.project,
      tasks: [],
    };
    option.tasks.push({ taskCodeId: r.task_code_id, code: r.code, name: r.name });
    options.set(r.project_id, option);
  }
  return [...options.values()];
}
