// The rows of a person's own week: add one, remove a blank one, copy last week's. A row is a project and one of
// its allowed tasks. Every statement carries the lock predicate, and adding checks the assignment (SEC-12).
import { fail } from '../lib/errors';
import { newId } from '../lib/ids';
import { MAX_WEEK_ROWS } from '../lib/limits';
import { addDays, isEditable } from '../lib/week';
import { addAssignment } from './assignments';
import { WEEK_OPEN } from './entry-writes';
import { projectsParam, type Scope } from './scope';
import { readRows, weekState } from './week-view';

const ADD = `INSERT INTO week_row (id, client_id, person_id, week_start, project_id, task_code_id, position)
SELECT ?1, a.client_id, a.person_id, ?2, a.project_id, pt.task_code_id,
  coalesce((SELECT max(w.position) + 1 FROM week_row w WHERE w.person_id = a.person_id AND w.week_start = ?2), 0)
FROM assignment a
JOIN project p ON p.client_id = a.client_id AND p.id = a.project_id AND p.archived_at IS NULL
JOIN client c ON c.id = p.client_id AND c.archived_at IS NULL
JOIN project_task pt ON pt.client_id = p.client_id AND pt.project_id = p.id
  AND pt.task_code_id = ?4 AND pt.archived_at IS NULL
JOIN task_code t ON t.id = pt.task_code_id AND t.archived_at IS NULL
WHERE a.person_id = ?5 AND a.project_id = ?3
  AND (SELECT count(*) FROM week_row w WHERE w.person_id = a.person_id AND w.week_start = ?2) < ?6
  AND NOT EXISTS (SELECT 1 FROM week_submission s
    WHERE s.person_id = a.person_id AND s.week_start = ?2 AND s.state IN ('submitted', 'approved'))
ON CONFLICT DO NOTHING`;

const REMOVE = `DELETE FROM week_row
WHERE id = ?1 AND person_id = ?2 AND week_start = ?3
  AND (?4 IS NULL OR project_id IN (SELECT value FROM json_each(?4)))
  AND NOT EXISTS (SELECT 1 FROM entry e WHERE e.row_id = week_row.id)
  AND ${WEEK_OPEN('week_row.id')}`;

const ASSIGNED = 'SELECT 1 AS found FROM assignment WHERE person_id = ?1 AND project_id = ?2';
const TASK_ALLOWED = `SELECT 1 AS found FROM project_task pt
JOIN task_code t ON t.id = pt.task_code_id AND t.archived_at IS NULL
WHERE pt.project_id = ?1 AND pt.task_code_id = ?2 AND pt.archived_at IS NULL`;
const PRESENT = `SELECT 1 AS found FROM week_row
WHERE person_id = ?1 AND week_start = ?2 AND project_id = ?3 AND task_code_id = ?4`;
const ROW_COUNT = 'SELECT count(*) AS n FROM week_row WHERE person_id = ?1 AND week_start = ?2';

const addStatement = (
  db: D1Database,
  personId: string,
  weekStart: string,
  projectId: string,
  taskCodeId: string,
) => db.prepare(ADD).bind(newId(), weekStart, projectId, taskCodeId, personId, MAX_WEEK_ROWS);

async function requireOpen(scope: Scope, db: D1Database, personId: string, weekStart: string) {
  if (!isEditable(await weekState(scope, db, personId, weekStart))) fail('locked');
}

/**
 * Adds a row for a project the person is assigned to and one of its live allowed tasks. An unassigned project
 * is `forbidden`, except to an all-clients scope, which is assigned first through the audited assignment write
 * (a steward may already do that from the project page). A row already in the week is left as it is.
 */
export async function addRow(
  scope: Scope,
  db: D1Database,
  weekStart: string,
  projectId: string,
  taskCodeId: string,
  now = Date.now(),
): Promise<void> {
  const personId = scope.actorId ?? fail('forbidden');
  const assigned = await db.prepare(ASSIGNED).bind(personId, projectId).first();
  if (!assigned && scope.kind !== 'all') fail('forbidden', 'you are not assigned to that project');
  await requireOpen(scope, db, personId, weekStart);
  if (!assigned) {
    if (!(await db.prepare(TASK_ALLOWED).bind(projectId, taskCodeId).first()))
      fail('invalid_input', 'that project or task cannot be booked to');
    await addAssignment(scope, db, projectId, personId, now);
  }
  const added = await addStatement(db, personId, weekStart, projectId, taskCodeId).run();
  if (added.meta.changes === 1) return;
  if (await db.prepare(PRESENT).bind(personId, weekStart, projectId, taskCodeId).first()) return;
  const held = await db.prepare(ROW_COUNT).bind(personId, weekStart).first<{ n: number }>();
  if ((held?.n ?? 0) >= MAX_WEEK_ROWS)
    fail('invalid_input', `a week holds at most ${String(MAX_WEEK_ROWS)} rows`);
  fail('invalid_input', 'that project or task cannot be booked to');
}

/** Removes a row only when it holds no entries: every cell blank or zero with no note. */
export async function removeRow(
  scope: Scope,
  db: D1Database,
  weekStart: string,
  rowId: string,
): Promise<void> {
  const personId = scope.actorId ?? fail('forbidden');
  // A member may clear a blank row of a project they no longer have, which the grid shows read-only.
  const every = scope.kind === 'member';
  const removed = await db
    .prepare(REMOVE)
    .bind(rowId, personId, weekStart, every ? null : projectsParam(scope))
    .run();
  if (removed.meta.changes === 1) return;
  const rows = await readRows(scope, db, personId, weekStart, every);
  if (!rows.some((row) => row.row_id === rowId))
    fail('forbidden', 'that row is not yours to remove');
  await requireOpen(scope, db, personId, weekStart);
  fail('row_not_empty');
}

/**
 * Adds last week's rows to this week with no hours or notes. A row whose project is no longer assigned or live,
 * or whose task is no longer allowed, is skipped, as is one already present. Returns how many rows were added.
 */
export async function copyLastWeek(
  scope: Scope,
  db: D1Database,
  weekStart: string,
): Promise<number> {
  const personId = scope.actorId ?? fail('forbidden');
  await requireOpen(scope, db, personId, weekStart);
  const last = await readRows(scope, db, personId, addDays(weekStart, -7));
  if (last.length === 0) return 0;
  const results = await db.batch(
    last.map((row) => addStatement(db, personId, weekStart, row.project_id, row.task_code_id)),
  );
  return results.reduce((added, result) => added + result.meta.changes, 0);
}
