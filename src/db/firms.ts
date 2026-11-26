// Firms: a person belongs to one, and each firm is booked as a client, which holds its internal and
// overhead projects and gives the firm its name. A firm is created with its client and that client's first data key.
import type { AuditedBatch } from './audit';
import { insertClient, insertClientKey } from './clients';
import { newClientKey } from '../lib/note-crypto';
import { newId } from '../lib/ids';

export interface FirmRow {
  id: string;
  /** The firm's client's name: renaming the client renames the firm. */
  name: string;
  client_id: string;
}

const FROM = 'FROM firm f JOIN client c ON c.id = f.client_id';
const LIST = `SELECT f.id, c.name, f.client_id ${FROM} ORDER BY c.name`;
const ONE = `SELECT f.id, c.name, f.client_id ${FROM} WHERE f.id = ?1`;
const INSERT = 'INSERT INTO firm (id, client_id) VALUES (?1, ?2)';

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
  batch.also(db.prepare(INSERT).bind(firm.id, firm.client_id));
  return firm;
}
