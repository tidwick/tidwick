// Task codes are global and admin-owned: no client, so reads take no scope; writes take it for the actor.
// Codes are unique ignoring case and never deleted, only archived.
import { fail } from '../lib/errors';
import { newId } from '../lib/ids';
import { auditedBatch, retryOnce, type AuditedBatch } from './audit';
import type { Scope } from './scope';
import { translateUnique } from './unique';

export interface TaskCodeRow {
  id: string;
  code: string;
  name: string;
  created_at: number;
  archived_at: number | null;
}

const LIST = `SELECT id, code, name, created_at, archived_at FROM task_code
ORDER BY archived_at IS NOT NULL, code`;
const ONE = 'SELECT id, code, name, created_at, archived_at FROM task_code WHERE id = ?1';
const INSERT = 'INSERT INTO task_code (id, code, name, created_at) VALUES (?1, ?2, ?3, ?4)';
const RENAME = 'UPDATE task_code SET name = ?2 WHERE id = ?1 AND name = ?3';
const ARCHIVE = 'UPDATE task_code SET archived_at = ?2 WHERE id = ?1 AND archived_at IS ?3';

export async function listTaskCodes(db: D1Database): Promise<TaskCodeRow[]> {
  return (await db.prepare(LIST).all<TaskCodeRow>()).results;
}

export async function taskCodeById(db: D1Database, id: string): Promise<TaskCodeRow | null> {
  return db.prepare(ONE).bind(id).first<TaskCodeRow>();
}

async function runTaken(batch: AuditedBatch): Promise<void> {
  try {
    await batch.run();
  } catch (error) {
    translateUnique(error, { 'task_code.code': 'code_taken' });
    throw error;
  }
}

/** Creates a task code with one `taskCodes.create` event; a taken code is `code_taken`. */
export async function createTaskCode(
  scope: Scope,
  db: D1Database,
  input: { code: string; name: string },
  now: number,
): Promise<TaskCodeRow> {
  const id = newId();
  await retryOnce(async () => {
    const batch = await auditedBatch(scope, db);
    await batch.record(
      db.prepare(INSERT).bind(id, input.code, input.name, now),
      {
        at: now,
        action: 'taskCodes.create',
        clientId: null,
        target: `task_code:${id}`,
        after: input,
      },
      1,
    );
    await runTaken(batch);
  });
  return { id, ...input, created_at: now, archived_at: null };
}

/** Renames a task code's label; the code itself never changes, since exports and imports match on it. */
export async function renameTaskCode(
  scope: Scope,
  db: D1Database,
  id: string,
  name: string,
  now: number,
): Promise<void> {
  await retryOnce(async () => {
    const before = (await taskCodeById(db, id)) ?? fail('not_found');
    const batch = await auditedBatch(scope, db);
    await batch.record(
      db.prepare(RENAME).bind(id, name, before.name),
      {
        at: now,
        action: 'taskCodes.update',
        clientId: null,
        target: `task_code:${id}`,
        before: { name: before.name },
        after: { name },
      },
      1,
    );
    await batch.run();
  });
}

/** Archives a task code, or restores it with `restore`; the wrong direction is `bad_transition`. */
export async function archiveTaskCode(
  scope: Scope,
  db: D1Database,
  id: string,
  restore: boolean,
  now: number,
): Promise<void> {
  await retryOnce(async () => {
    const before = (await taskCodeById(db, id)) ?? fail('not_found');
    if ((before.archived_at !== null) !== restore) fail('bad_transition');
    const after = restore ? null : now;
    const batch = await auditedBatch(scope, db);
    await batch.record(
      db.prepare(ARCHIVE).bind(id, after, before.archived_at),
      {
        at: now,
        action: 'taskCodes.archive',
        clientId: null,
        target: `task_code:${id}`,
        before: { archived_at: before.archived_at },
        after: { archived_at: after },
      },
      1,
    );
    await batch.run();
  });
}
