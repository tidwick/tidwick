// The allowed task list per project. Rows are never deleted, because week rows reference them: a task taken
// off the list is stamped archived, and putting it back clears the stamp.
import { fail } from '../lib/errors';
import { auditedBatch, retryOnce } from './audit';
import { projectById } from './projects';
import type { Scope } from './scope';

export interface AllowedTask {
  task_code_id: string;
  code: string;
  name: string;
  code_archived_at: number | null;
}

const ALLOWED = `SELECT t.task_code_id, c.code, c.name, c.archived_at AS code_archived_at
FROM project_task t JOIN task_code c ON c.id = t.task_code_id
WHERE t.project_id = ?1 AND t.archived_at IS NULL ORDER BY c.code`;

const LIVE_CODES = `SELECT id FROM task_code WHERE archived_at IS NULL AND id IN (SELECT value FROM json_each(?1))`;

const ADD = `INSERT INTO project_task (client_id, project_id, task_code_id)
SELECT ?1, ?2, value FROM json_each(?3) WHERE true
ON CONFLICT (client_id, project_id, task_code_id) DO UPDATE SET archived_at = NULL
WHERE project_task.archived_at IS NOT NULL`;

/** Fails NOT NULL, so the batch rolls back, unless the project's live allowed list is still exactly the set read. */
const STALE = `INSERT INTO project_task (client_id, project_id, task_code_id) SELECT ?1, ?2, NULL
WHERE (SELECT count(*) FROM project_task WHERE project_id = ?2 AND archived_at IS NULL) <> json_array_length(?3)
  OR EXISTS (SELECT 1 FROM json_each(?3) WHERE value NOT IN (
    SELECT task_code_id FROM project_task WHERE project_id = ?2 AND archived_at IS NULL))`;

const REMOVE = `UPDATE project_task SET archived_at = ?4
WHERE client_id = ?1 AND project_id = ?2 AND archived_at IS NULL
  AND task_code_id NOT IN (SELECT value FROM json_each(?3))`;

/** The project's allowed tasks, or a scoped miss as `not_found`; the week grid offers these (archived codes included). */
export async function allowedTasks(
  scope: Scope,
  db: D1Database,
  projectId: string,
): Promise<AllowedTask[]> {
  if (!(await projectById(scope, db, projectId))) fail('not_found');
  return (await db.prepare(ALLOWED).bind(projectId).all<AllowedTask>()).results;
}

/**
 * Replaces the allowed list with `taskCodeIds`, all live task codes. Writes nothing when the list is
 * unchanged; otherwise one `projects.setTasks` event with the list before and after. A list changed since
 * the read rolls the batch back and retries, so the event's before is what it replaced.
 */
export async function setProjectTasks(
  scope: Scope,
  db: D1Database,
  projectId: string,
  taskCodeIds: readonly string[],
  now: number,
): Promise<void> {
  const wanted = [...new Set(taskCodeIds)].toSorted();
  const live = await db.prepare(LIVE_CODES).bind(JSON.stringify(wanted)).all<{ id: string }>();
  if (live.results.length !== wanted.length) fail('invalid_input', 'unknown or archived task code');
  await retryOnce(async () => {
    const project = (await projectById(scope, db, projectId)) ?? fail('not_found');
    if (project.archived_at !== null) fail('archived');
    const before = (await allowedTasks(scope, db, projectId)).map((t) => t.task_code_id).toSorted();
    const removed = before.filter((id) => !wanted.includes(id));
    if (removed.length === 0 && wanted.every((id) => before.includes(id))) return;
    const json = JSON.stringify(wanted);
    const batch = await auditedBatch(scope, db);
    batch.also(db.prepare(STALE).bind(project.client_id, projectId, JSON.stringify(before)));
    batch.also(db.prepare(ADD).bind(project.client_id, projectId, json));
    await batch.record(
      db.prepare(REMOVE).bind(project.client_id, projectId, json, now),
      {
        at: now,
        action: 'projects.setTasks',
        clientId: project.client_id,
        target: `project:${projectId}`,
        before: { task_codes: before },
        after: { task_codes: wanted },
      },
      removed.length,
    );
    await batch.run();
  });
}
