// Firms: a person belongs to one, and each firm is booked as a client, which holds its internal and
// overhead projects. A firm is created with its client and that client's first data key.
import type { AuditedBatch } from './audit';
import { insertClient, insertClientKey } from './clients';
import { newClientKey } from '../lib/note-crypto';
import { newId } from '../lib/ids';

export interface FirmRow {
  id: string;
  name: string;
  client_id: string;
}

const LIST = 'SELECT id, name, client_id FROM firm ORDER BY name';
const ONE = 'SELECT id, name, client_id FROM firm WHERE id = ?1';
const INSERT = 'INSERT INTO firm (id, name, client_id) VALUES (?1, ?2, ?3)';

export async function listFirms(db: D1Database): Promise<FirmRow[]> {
  return (await db.prepare(LIST).all<FirmRow>()).results;
}

export async function firmById(db: D1Database, id: string): Promise<FirmRow | null> {
  return db.prepare(ONE).bind(id).first<FirmRow>();
}

/** Adds a firm, its client and the client's key to `batch` without events: the caller's own event names them. */
export async function addFirm(
  batch: AuditedBatch,
  db: D1Database,
  kek: string,
  name: string,
  now: number,
): Promise<FirmRow> {
  const firm = { id: newId(), name, client_id: newId() };
  const key = await newClientKey(kek, firm.client_id, 1);
  batch.also(insertClient(db, firm.client_id, name, now));
  batch.also(insertClientKey(db, firm.client_id, key, now));
  batch.also(db.prepare(INSERT).bind(firm.id, name, firm.client_id));
  return firm;
}
