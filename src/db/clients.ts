// Clients: reads through the caller's scope, and the audited writes. A member sees the clients that hold a
// project they are assigned to, and the ones they created themselves (found in the audit log), so a client
// they just made does not vanish before their first project. Names are unique ignoring case.
import { newId } from '../lib/ids';
import { fail } from '../lib/errors';
import { newClientKey, type WrappedKey } from '../lib/note-crypto';
import { auditedBatch, retryOnce, type AuditedBatch } from './audit';
import { projectsParam, requireAll, type Scope } from './scope';
import { translateUnique } from './unique';

export interface ClientRow {
  id: string;
  name: string;
  created_at: number;
  archived_at: number | null;
  erased_at: number | null;
}

const LIST = `SELECT c.id, c.name, c.created_at, c.archived_at, c.erased_at FROM client c
WHERE ?1 IS NULL
  OR c.id IN (SELECT p.client_id FROM project p WHERE p.id IN (SELECT value FROM json_each(?1)))
  OR c.id IN (SELECT e.client_id FROM audit_event e
              WHERE e.action = 'clients.create' AND e.actor_id = ?2 AND e.client_id IS NOT NULL)
ORDER BY c.name`;

const ONE = `SELECT c.id, c.name, c.created_at, c.archived_at, c.erased_at FROM client c
WHERE c.id = ?3 AND (?1 IS NULL
  OR c.id IN (SELECT p.client_id FROM project p WHERE p.id IN (SELECT value FROM json_each(?1)))
  OR c.id IN (SELECT e.client_id FROM audit_event e
              WHERE e.action = 'clients.create' AND e.actor_id = ?2 AND e.client_id IS NOT NULL))`;

const INSERT = 'INSERT INTO client (id, name, created_at) VALUES (?1, ?2, ?3)';
const INSERT_KEY = `INSERT INTO client_key (client_id, version, wrapped, iv, kek_id, created_at)
VALUES (?1, 1, ?2, ?3, ?4, ?5)`;
const RENAME = 'UPDATE client SET name = ?2 WHERE id = ?1 AND name = ?3 AND archived_at IS ?4';
const ARCHIVE = 'UPDATE client SET archived_at = ?2 WHERE id = ?1 AND archived_at IS ?3';

/** Every client the scope may see, by name. */
export async function listClients(scope: Scope, db: D1Database): Promise<ClientRow[]> {
  const result = await db.prepare(LIST).bind(projectsParam(scope), scope.actorId).all<ClientRow>();
  return result.results;
}

/** One client, or null when it does not exist or the scope may not see it (the caller answers 404). */
export async function clientById(
  scope: Scope,
  db: D1Database,
  id: string,
): Promise<ClientRow | null> {
  return db.prepare(ONE).bind(projectsParam(scope), scope.actorId, id).first<ClientRow>();
}

export function insertClient(db: D1Database, id: string, name: string, now: number) {
  return db.prepare(INSERT).bind(id, name, now);
}

export function insertClientKey(db: D1Database, id: string, key: WrappedKey, now: number) {
  return db.prepare(INSERT_KEY).bind(id, key.wrapped, key.iv, key.kekId, now);
}

/**
 * Creates a client and its first data key in one batch with one `clients.create` event. A taken name is
 * `name_taken` whether or not the existing client is visible to the caller.
 */
export async function createClient(
  scope: Scope,
  db: D1Database,
  kek: string,
  name: string,
  now: number,
): Promise<ClientRow> {
  const id = newId();
  const key = await newClientKey(kek, id, 1);
  await retryOnce(async () => {
    const batch = await auditedBatch(scope, db);
    await batch.record(
      insertClient(db, id, name, now),
      { at: now, action: 'clients.create', clientId: id, target: `client:${id}`, after: { name } },
      1,
    );
    batch.also(insertClientKey(db, id, key, now));
    await runTaken(batch);
  });
  return { id, name, created_at: now, archived_at: null, erased_at: null };
}

async function runTaken(batch: AuditedBatch): Promise<void> {
  try {
    await batch.run();
  } catch (error) {
    translateUnique(error, { 'client.name': 'name_taken' });
    throw error;
  }
}

/** Renames a client; the write repeats the name it read, so a concurrent rename makes it retry once. */
export async function renameClient(
  scope: Scope,
  db: D1Database,
  id: string,
  name: string,
  now: number,
): Promise<void> {
  requireAll(scope);
  await retryOnce(async () => {
    const before = (await clientById(scope, db, id)) ?? fail('not_found');
    const batch = await auditedBatch(scope, db);
    await batch.record(
      db.prepare(RENAME).bind(id, name, before.name, before.archived_at),
      {
        at: now,
        action: 'clients.update',
        clientId: id,
        target: `client:${id}`,
        before: { name: before.name },
        after: { name },
      },
      1,
    );
    await runTaken(batch);
  });
}

/** Archives a client, or restores it with `restore`; the wrong direction is `bad_transition`. Nothing is deleted. */
export async function archiveClient(
  scope: Scope,
  db: D1Database,
  id: string,
  restore: boolean,
  now: number,
): Promise<void> {
  requireAll(scope);
  await retryOnce(async () => {
    const before = (await clientById(scope, db, id)) ?? fail('not_found');
    if ((before.archived_at !== null) !== restore) fail('bad_transition');
    const after = restore ? null : now;
    const batch = await auditedBatch(scope, db);
    await batch.record(
      db.prepare(ARCHIVE).bind(id, after, before.archived_at),
      {
        at: now,
        action: 'clients.archive',
        clientId: id,
        target: `client:${id}`,
        before: { archived_at: before.archived_at },
        after: { archived_at: after },
      },
      1,
    );
    await batch.run();
  });
}
