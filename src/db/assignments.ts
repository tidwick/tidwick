// Who is assigned to which project. An assignment is what lets a member see a project and book time to it.
import { fail } from '../lib/errors';
import { auditedBatch, retryOnce } from './audit';
import { personById } from './people';
import { projectById } from './projects';
import { requireAll, type Scope } from './scope';
import { translateUnique } from './unique';

export interface AssignedPerson {
  person_id: string;
  name: string;
  email: string;
  assigned_at: number;
}

const ASSIGNED = `SELECT a.person_id, p.name, p.email, a.assigned_at
FROM assignment a JOIN person p ON p.id = a.person_id
WHERE a.project_id = ?1 AND p.offboarded_at IS NULL ORDER BY p.name`;

const ADD =
  'INSERT INTO assignment (client_id, project_id, person_id, assigned_at) VALUES (?1, ?2, ?3, ?4)';
const REMOVE =
  'DELETE FROM assignment WHERE project_id = ?1 AND person_id = ?2 AND assigned_at = ?3';
const UNASSIGNED = `SELECT p.client_id, p.id FROM project p JOIN client c ON c.id = p.client_id
WHERE p.archived_at IS NULL AND c.archived_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM assignment a WHERE a.project_id = p.id AND a.person_id = ?1)
ORDER BY p.id LIMIT ?2`;

/** Projects one assign-to-all press adds: two statements each (the row and its event) must stay under D1's 1000 per invocation even when `retryOnce` re-sends the batch. */
export const ASSIGN_ALL_MAX = 200;
const ONE = 'SELECT assigned_at FROM assignment WHERE project_id = ?1 AND person_id = ?2';

/** Active people assigned to a project the scope can see; a miss is `not_found`. */
export async function assignedTo(
  scope: Scope,
  db: D1Database,
  projectId: string,
): Promise<AssignedPerson[]> {
  if (!(await projectById(scope, db, projectId))) fail('not_found');
  return (await db.prepare(ASSIGNED).bind(projectId).all<AssignedPerson>()).results;
}

/** Assigns an active person to a live project, one `assignments.add` event; a repeat is `already_assigned`. */
export async function addAssignment(
  scope: Scope,
  db: D1Database,
  projectId: string,
  personId: string,
  now: number,
): Promise<void> {
  requireAll(scope);
  const project = (await projectById(scope, db, projectId)) ?? fail('not_found');
  if (project.archived_at !== null) fail('archived');
  const person = await personById(db, personId);
  if (!person || person.offboarded_at !== null) fail('not_found');
  await retryOnce(async () => {
    const batch = await auditedBatch(scope, db);
    await batch.record(
      db.prepare(ADD).bind(project.client_id, projectId, personId, now),
      {
        at: now,
        action: 'assignments.add',
        clientId: project.client_id,
        target: `assignment:${projectId}:${personId}`,
        after: { project_id: projectId, person_id: personId },
      },
      1,
    );
    try {
      await batch.run();
    } catch (error) {
      translateUnique(error, { 'assignment.project_id, assignment.person_id': 'already_assigned' });
      throw error;
    }
  });
}

/** Removes an assignment, one `assignments.remove` event; the person's past entries stay. */
export async function removeAssignment(
  scope: Scope,
  db: D1Database,
  projectId: string,
  personId: string,
  now: number,
): Promise<void> {
  requireAll(scope);
  const project = (await projectById(scope, db, projectId)) ?? fail('not_found');
  await retryOnce(async () => {
    const before = await db.prepare(ONE).bind(projectId, personId).first<{ assigned_at: number }>();
    if (!before) fail('not_found');
    const batch = await auditedBatch(scope, db);
    await batch.record(
      db.prepare(REMOVE).bind(projectId, personId, before.assigned_at),
      {
        at: now,
        action: 'assignments.remove',
        clientId: project.client_id,
        target: `assignment:${projectId}:${personId}`,
        before: { project_id: projectId, person_id: personId, assigned_at: before.assigned_at },
      },
      1,
    );
    await batch.run();
  });
}

/**
 * Assigns an active person to every live project they are not on, one `assignments.add` event each, in one
 * batch; a one-shot, not a standing rule. At most `max` are added per call, so a firm with more projects presses it
 * again until it returns 0. Returns how many were added.
 */
export async function addAllAssignments(
  scope: Scope,
  db: D1Database,
  personId: string,
  now: number,
  max: number = ASSIGN_ALL_MAX,
): Promise<number> {
  requireAll(scope);
  const person = await personById(db, personId);
  if (!person || person.offboarded_at !== null) fail('not_found');
  return retryOnce(async () => {
    const todo = (
      await db.prepare(UNASSIGNED).bind(personId, max).all<{ client_id: string; id: string }>()
    ).results;
    if (todo.length === 0) return 0;
    const batch = await auditedBatch(scope, db);
    for (const { client_id, id } of todo) {
      await batch.record(
        db.prepare(ADD).bind(client_id, id, personId, now),
        {
          at: now,
          action: 'assignments.add',
          clientId: client_id,
          target: `assignment:${id}:${personId}`,
          after: { project_id: id, person_id: personId },
        },
        1,
      );
    }
    await batch.run();
    return todo.length;
  });
}
