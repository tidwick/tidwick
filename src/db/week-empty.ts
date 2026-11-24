// Why add-row has nothing to pick, so the grid can say what to do next instead of only that it is empty.
import type { EmptyCause } from '../lib/week';
import type { Scope } from './scope';

// Live projects with no live allowed task: every one for an all-clients scope, else the person's assigned ones.
const NO_TASKS = `SELECT p.id AS projectId, p.name FROM project p
JOIN client c ON c.id = p.client_id AND c.archived_at IS NULL
WHERE p.archived_at IS NULL
  AND (?1 IS NULL OR p.id IN (SELECT a.project_id FROM assignment a WHERE a.person_id = ?1))
  AND NOT EXISTS (SELECT 1 FROM project_task pt
    JOIN task_code t ON t.id = pt.task_code_id AND t.archived_at IS NULL
    WHERE pt.project_id = p.id AND pt.archived_at IS NULL)
ORDER BY p.name`;

const STEWARDS = `SELECT DISTINCT p.name FROM person p JOIN person_role r ON r.person_id = p.id
WHERE p.offboarded_at IS NULL ORDER BY p.name`;

/** The cause of an empty add-row for this person; call it only when `addRowOptions` came back empty. */
export async function emptyCause(
  scope: Scope,
  db: D1Database,
  personId: string,
): Promise<EmptyCause> {
  const steward = scope.kind === 'all';
  const bare = (
    await db
      .prepare(NO_TASKS)
      .bind(steward ? null : personId)
      .all<{ projectId: string; name: string }>()
  ).results;
  if (bare.length > 0) return { kind: 'no_tasks', projects: bare };
  if (steward) return { kind: 'no_projects' };
  const names = (await db.prepare(STEWARDS).all<{ name: string }>()).results;
  return { kind: 'unassigned', stewards: names.map((n) => n.name) };
}
