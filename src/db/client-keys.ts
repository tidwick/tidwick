// A client's data keys for one request. A key is unwrapped on first use, under whichever KEK its row names, and
// held only by the ring the caller made, so it lives no longer than the request. Only this file,
// `key-rewrap.ts` and `src/lib/note-crypto.ts` see one.
import { fail } from '../lib/errors';
import { kekFor, unwrapClientKey, type NoteKeks } from '../lib/note-crypto';
import { blobBytes } from './credentials';

type Bytes = Uint8Array<ArrayBuffer>;

interface KeyRow {
  version: number;
  wrapped: ArrayBuffer | number[];
  iv: ArrayBuffer | number[];
  kek_id: string;
}

export interface DataKey {
  version: number;
  key: Bytes;
}

export interface KeyRing {
  /** The client's newest key, or null when the client's keys were destroyed by erasure. */
  current(clientId: string): Promise<DataKey | null>;
  /** Whether the client has any key row, live or destroyed; false means it never got one. */
  has(clientId: string): Promise<boolean>;
  /** One version of the client's key, or null when it was destroyed. */
  version(clientId: string, version: number): Promise<Bytes | null>;
}

const NEWEST = `SELECT version, wrapped, iv, kek_id FROM client_key
WHERE client_id = ?1 AND destroyed_at IS NULL ORDER BY version DESC LIMIT 1`;

const ANY = 'SELECT 1 AS found FROM client_key WHERE client_id = ?1 LIMIT 1';

const ONE = `SELECT version, wrapped, iv, kek_id FROM client_key
WHERE client_id = ?1 AND version = ?2 AND destroyed_at IS NULL`;

/**
 * A ring that remembers every key it has unwrapped, so a request reads each client's key row once. A row under
 * neither KEK is refused as `note_kek_missing`, never tried under the wrong one.
 */
export function keyRing(db: D1Database, keks: NoteKeks): KeyRing {
  const newest = new Map<string, Promise<DataKey | null>>();
  const byVersion = new Map<string, Promise<Bytes | null>>();

  const unwrap = async (clientId: string, row: KeyRow | null): Promise<DataKey | null> => {
    if (row === null) return null;
    const kek = (await kekFor(keks, row.kek_id)) ?? fail('note_kek_missing');
    const key = await unwrapClientKey(kek, clientId, row.version, {
      wrapped: blobBytes(row.wrapped),
      iv: blobBytes(row.iv),
    });
    return { version: row.version, key };
  };

  return {
    current(clientId) {
      const cached = newest.get(clientId);
      if (cached) return cached;
      const made = db
        .prepare(NEWEST)
        .bind(clientId)
        .first<KeyRow>()
        .then((row) => unwrap(clientId, row));
      newest.set(clientId, made);
      return made;
    },
    async has(clientId) {
      return (await db.prepare(ANY).bind(clientId).first<{ found: number }>()) !== null;
    },
    version(clientId, version) {
      const id = `${clientId}|${String(version)}`;
      const cached = byVersion.get(id);
      if (cached) return cached;
      const made = db
        .prepare(ONE)
        .bind(clientId, version)
        .first<KeyRow>()
        .then(async (row) => (await unwrap(clientId, row))?.key ?? null);
      byVersion.set(id, made);
      return made;
    },
  };
}
