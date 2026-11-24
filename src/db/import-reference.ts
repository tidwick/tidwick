// What an import reads: the reference data its rows are matched against, the cells, rows and submissions the
// people in the file already have in the weeks the file touches, the batch the same file left, and which of
// its assignments are already held. Reads only; `import-apply.ts` writes.
import type { ImportRow } from '../lib/import';
import type { ImportExisting, ImportReference } from '../lib/import-types';
import { projectNumberRequired } from './settings';

interface PersonRecord {
  id: string;
  email: string;
  offboarded_at: number | null;
}
interface ClientRecord {
  id: string;
  name: string;
  archived_at: number | null;
}
interface ProjectRecord {
  id: string;
  client_id: string;
  name: string;
  number: string | null;
  archived_at: number | null;
}
interface TaskRecord {
  id: string;
  code: string;
  name: string;
  archived_at: number | null;
}

const PEOPLE = 'SELECT id, email, offboarded_at FROM person';
const CLIENTS = 'SELECT id, name, archived_at FROM client WHERE erased_at IS NULL';
const PROJECTS = 'SELECT id, client_id, name, number, archived_at FROM project';
const TASKS = 'SELECT id, code, name, archived_at FROM task_code';
const ALLOWED = 'SELECT project_id, task_code_id FROM project_task WHERE archived_at IS NULL';

export async function loadReference(db: D1Database): Promise<ImportReference> {
  const all = async <T>(statement: D1PreparedStatement): Promise<T[]> =>
    (await statement.all<T>()).results;
  const [people, clients, projects, tasks, allowed] = await Promise.all([
    all<PersonRecord>(db.prepare(PEOPLE)),
    all<ClientRecord>(db.prepare(CLIENTS)),
    all<ProjectRecord>(db.prepare(PROJECTS)),
    all<TaskRecord>(db.prepare(TASKS)),
    all<{ project_id: string; task_code_id: string }>(db.prepare(ALLOWED)),
  ]);
  return {
    people: people.map((p) => ({ id: p.id, email: p.email, offboarded: p.offboarded_at !== null })),
    clients: clients.map((c) => ({ id: c.id, name: c.name, archived: c.archived_at !== null })),
    projects: projects.map((p) => ({
      id: p.id,
      clientId: p.client_id,
      name: p.name,
      number: p.number,
      archived: p.archived_at !== null,
    })),
    tasks: tasks.map((t) => ({ ...t, archived: t.archived_at !== null })),
    allowed: allowed.map((a) => ({ projectId: a.project_id, taskId: a.task_code_id })),
    numberRequired: await projectNumberRequired(db),
  };
}

const WEEKS = "(person_id || '|' || week_start) IN (SELECT value FROM json_each(?1))";

const CELLS = `SELECT r.person_id, r.week_start, r.project_id, r.task_code_id, e.dow, e.hundredths, e.import_id
FROM entry e JOIN week_row r ON r.client_id = e.client_id AND r.id = e.row_id
WHERE (r.person_id || '|' || r.week_start) IN (SELECT value FROM json_each(?1))`;
const ROWS = `SELECT id, person_id, week_start, project_id, task_code_id, position FROM week_row WHERE ${WEEKS}`;
const SUBMISSIONS = `SELECT person_id, week_start, state FROM week_submission WHERE ${WEEKS}`;

/** The person-weeks the rows name, as `<person id>|<week start>` keys. */
export function weekKeys(rows: readonly ImportRow[], ref: ImportReference): string[] {
  const ids = new Map(ref.people.map((p) => [p.email.toLowerCase(), p.id]));
  const keys = new Set<string>();
  for (const row of rows) {
    const id = ids.get(row.email.toLowerCase());
    if (id !== undefined) keys.add(`${id}|${row.weekStart}`);
  }
  return [...keys];
}

export async function loadExisting(
  db: D1Database,
  rows: readonly ImportRow[],
  ref: ImportReference,
): Promise<ImportExisting> {
  const keys = JSON.stringify(weekKeys(rows, ref));
  const run = async <T>(statement: D1PreparedStatement): Promise<T[]> =>
    (await statement.bind(keys).all<T>()).results;
  const [cells, weekRows, submissions] = await Promise.all([
    run<{
      person_id: string;
      week_start: string;
      project_id: string;
      task_code_id: string;
      dow: number;
      hundredths: number;
      import_id: string | null;
    }>(db.prepare(CELLS)),
    run<{
      id: string;
      person_id: string;
      week_start: string;
      project_id: string;
      task_code_id: string;
      position: number;
    }>(db.prepare(ROWS)),
    run<{ person_id: string; week_start: string; state: string }>(db.prepare(SUBMISSIONS)),
  ]);
  return {
    cells: cells.map((c) => ({
      personId: c.person_id,
      weekStart: c.week_start,
      projectId: c.project_id,
      taskId: c.task_code_id,
      dow: c.dow,
      hundredths: c.hundredths,
      importId: c.import_id,
    })),
    rows: weekRows.map((r) => ({
      id: r.id,
      personId: r.person_id,
      weekStart: r.week_start,
      projectId: r.project_id,
      taskId: r.task_code_id,
      position: r.position,
    })),
    submissions: submissions.map((s) => ({
      personId: s.person_id,
      weekStart: s.week_start,
      state: s.state,
    })),
  };
}

const BATCH = 'SELECT mapping_hash, finished_at, entries_written FROM import_batch WHERE id = ?1';

/** The batch this file left before, if any: the mapping it was applied under, when, and how many entries. */
export async function priorBatch(
  db: D1Database,
  id: string,
): Promise<{ mappingHash: string; finishedAt: number | null; entries: number } | null> {
  const row = await db
    .prepare(BATCH)
    .bind(id)
    .first<{ mapping_hash: string; finished_at: number | null; entries_written: number }>();
  return row === null
    ? null
    : { mappingHash: row.mapping_hash, finishedAt: row.finished_at, entries: row.entries_written };
}

const HELD = `SELECT j.value ->> '$.p' AS person_id, j.value ->> '$.j' AS project_id FROM json_each(?1) j
WHERE EXISTS (SELECT 1 FROM assignment a WHERE a.person_id = j.value ->> '$.p' AND a.project_id = j.value ->> '$.j')`;

/** The `person|project` keys of the pairs, sent as JSON chunks, that are already assignments. */
export async function heldAssignments(
  db: D1Database,
  chunks: readonly string[],
): Promise<Set<string>> {
  const held = new Set<string>();
  for (const chunk of chunks) {
    const { results } = await db
      .prepare(HELD)
      .bind(chunk)
      .all<{ person_id: string; project_id: string }>();
    for (const r of results) held.add(`${r.person_id}|${r.project_id}`);
  }
  return held;
}
