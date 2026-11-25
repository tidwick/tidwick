// Projects: reads through the caller's scope and the audited writes. A project belongs to one client, has an
// optional number unique when present (YY-NNNN), and is never deleted, only archived. Its creator is assigned.
import { fail } from '../lib/errors';
import { newId } from '../lib/ids';
import { parseProjectNumber } from '../lib/project-number';
import { auditedBatch, retryOnce, type AuditedBatch } from './audit';
import { clientById } from './clients';
import { projectsParam, requireAll, type Scope } from './scope';
import { projectNumberRequired } from './settings';
import { translateUnique } from './unique';

export interface ProjectRow {
  id: string;
  client_id: string;
  name: string;
  number: string | null;
  created_at: number;
  archived_at: number | null;
}

export interface ProjectInput {
  name: string;
  /** Raw text from the form; blank means none, anything else must be YY-NNNN. */
  number: string;
}

const LIST = `SELECT p.id, p.client_id, p.name, p.number, p.created_at, p.archived_at FROM project p
WHERE p.client_id = ?2 AND (?1 IS NULL OR p.id IN (SELECT value FROM json_each(?1)))
ORDER BY p.name`;

const ONE = `SELECT p.id, p.client_id, p.name, p.number, p.created_at, p.archived_at FROM project p
WHERE p.id = ?2 AND (?1 IS NULL OR p.id IN (SELECT value FROM json_each(?1)))`;

const UNNUMBERED = `SELECT p.id, p.name, c.name AS client_name FROM project p JOIN client c ON c.id = p.client_id
WHERE p.number IS NULL AND p.archived_at IS NULL AND c.archived_at IS NULL
  AND (?1 IS NULL OR p.id IN (SELECT value FROM json_each(?1)))
ORDER BY c.name, p.name LIMIT ?2`;

const INSERT = `INSERT INTO project (id, client_id, name, number, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`;
const ASSIGN =
  'INSERT INTO assignment (client_id, project_id, person_id, assigned_at) VALUES (?1, ?2, ?3, ?4)';
const UPDATE = `UPDATE project SET name = ?2, number = ?3
WHERE id = ?1 AND name = ?4 AND number IS ?5 AND archived_at IS NULL`;
const NAME_IN_CLIENT =
  'SELECT 1 AS taken FROM project WHERE client_id = ?1 AND name = ?2 COLLATE NOCASE';
const ARCHIVE = 'UPDATE project SET archived_at = ?2 WHERE id = ?1 AND archived_at IS ?3';

const TAKEN = {
  'project.number': 'number_taken',
  'project.client_id, project.name': 'name_taken',
} as const;

/** A client's projects the scope may see, by name. */
export async function listProjects(
  scope: Scope,
  db: D1Database,
  clientId: string,
): Promise<ProjectRow[]> {
  const result = await db.prepare(LIST).bind(projectsParam(scope), clientId).all<ProjectRow>();
  return result.results;
}

/** One project, or null when missing or outside the scope (the caller answers 404). */
export async function projectById(
  scope: Scope,
  db: D1Database,
  id: string,
): Promise<ProjectRow | null> {
  return db.prepare(ONE).bind(projectsParam(scope), id).first<ProjectRow>();
}

/** Open projects the scope may see with no number, by client then name, at most `limit`, for the settings page. */
export async function projectsWithoutNumber(
  scope: Scope,
  db: D1Database,
  limit: number,
): Promise<{ id: string; name: string; client_name: string }[]> {
  const result = await db
    .prepare(UNNUMBERED)
    .bind(projectsParam(scope), limit)
    .all<{ id: string; name: string; client_name: string }>();
  return result.results;
}

async function cleanNumber(db: D1Database, raw: string): Promise<string | null> {
  const parsed = parseProjectNumber(raw);
  if (!parsed.ok) fail('invalid_input', 'project number must look like 26-0001');
  if (parsed.number === null && (await projectNumberRequired(db))) fail('number_required');
  return parsed.number;
}

async function runTaken(batch: AuditedBatch): Promise<void> {
  try {
    await batch.run();
  } catch (error) {
    translateUnique(error, TAKEN);
    throw error;
  }
}

/**
 * Creates a project under a client the caller can see and assigns the creator, in one batch with one
 * `projects.create` event. A client outside the caller's scope is `not_found`; an archived one is `archived`.
 * A name taken in the client answers before the number is tried, so a refused create reveals no number.
 */
export async function createProject(
  scope: Scope,
  db: D1Database,
  clientId: string,
  input: ProjectInput,
  now: number,
): Promise<ProjectRow> {
  const actor = scope.actorId ?? fail('forbidden');
  const number = await cleanNumber(db, input.number);
  const id = newId();
  await retryOnce(async () => {
    const client = (await clientById(scope, db, clientId)) ?? fail('not_found');
    if (client.archived_at !== null) fail('archived');
    if (await db.prepare(NAME_IN_CLIENT).bind(clientId, input.name).first()) fail('name_taken');
    const batch = await auditedBatch(scope, db);
    await batch.record(
      db.prepare(INSERT).bind(id, clientId, input.name, number, now),
      {
        at: now,
        action: 'projects.create',
        clientId,
        target: `project:${id}`,
        after: { client_id: clientId, name: input.name, number, assigned: [actor] },
      },
      1,
    );
    batch.also(db.prepare(ASSIGN).bind(clientId, id, actor, now));
    await runTaken(batch);
  });
  return { id, client_id: clientId, name: input.name, number, created_at: now, archived_at: null };
}

/** Changes a project's name and number; the write repeats what it read, so a concurrent change retries once. */
export async function updateProject(
  scope: Scope,
  db: D1Database,
  id: string,
  input: ProjectInput,
  now: number,
): Promise<void> {
  requireAll(scope);
  const number = await cleanNumber(db, input.number);
  await retryOnce(async () => {
    const before = (await projectById(scope, db, id)) ?? fail('not_found');
    if (before.archived_at !== null) fail('archived');
    const batch = await auditedBatch(scope, db);
    await batch.record(
      db.prepare(UPDATE).bind(id, input.name, number, before.name, before.number),
      {
        at: now,
        action: 'projects.update',
        clientId: before.client_id,
        target: `project:${id}`,
        before: { name: before.name, number: before.number },
        after: { name: input.name, number },
      },
      1,
    );
    await runTaken(batch);
  });
}

/** Archives a project, or restores it with `restore`; the wrong direction is `bad_transition`. */
export async function archiveProject(
  scope: Scope,
  db: D1Database,
  id: string,
  restore: boolean,
  now: number,
): Promise<void> {
  requireAll(scope);
  await retryOnce(async () => {
    const before = (await projectById(scope, db, id)) ?? fail('not_found');
    if ((before.archived_at !== null) !== restore) fail('bad_transition');
    const after = restore ? null : now;
    const batch = await auditedBatch(scope, db);
    await batch.record(
      db.prepare(ARCHIVE).bind(id, after, before.archived_at),
      {
        at: now,
        action: 'projects.archive',
        clientId: before.client_id,
        target: `project:${id}`,
        before: { archived_at: before.archived_at },
        after: { archived_at: after },
      },
      1,
    );
    await batch.run();
  });
}
