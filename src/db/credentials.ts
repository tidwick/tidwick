// Passkey credentials. A revoked credential or an offboarded person's credential never verifies.
import { OTHER_SIGNED_IN_ADMIN_OF_2 } from './admins';

export interface CredentialRow {
  id: string;
  person_id: string;
  public_key: ArrayBuffer | number[];
  counter: number;
  transports: string;
}

const INSERT = `INSERT INTO credential (id, person_id, public_key, counter, transports, created_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6)`;

const INSERT_LIVE = `INSERT INTO credential (id, person_id, public_key, counter, transports, created_at)
SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE EXISTS (
  SELECT 1 FROM session WHERE id_hash = ?7 AND person_id = ?2 AND revoked_at IS NULL AND expires_at > ?6
)`;

const ACTIVE = `SELECT c.id, c.person_id, c.public_key, c.counter, c.transports
FROM credential c JOIN person p ON p.id = c.person_id
WHERE c.id = ?1 AND c.revoked_at IS NULL AND p.offboarded_at IS NULL`;

const ACTIVE_OF = `SELECT id, person_id, public_key, counter, transports
FROM credential WHERE person_id = ?1 AND revoked_at IS NULL ORDER BY created_at, id`;

const USE = `UPDATE credential SET counter = ?3, last_used_at = ?4
WHERE id = ?1 AND counter = ?2 AND revoked_at IS NULL`;

const REVOKE_ALL =
  'UPDATE credential SET revoked_at = ?2 WHERE person_id = ?1 AND revoked_at IS NULL';

const LISTED = `SELECT id, created_at, last_used_at FROM credential
WHERE person_id = ?1 AND revoked_at IS NULL ORDER BY created_at, id`;

// Takes a person's last live passkey only when they keep a live identity and, for an admin, another admin holds a
// passkey, even against a concurrent removal (ADR 0003).
const REVOKE_ONE = `UPDATE credential SET revoked_at = ?3
WHERE id = ?1 AND person_id = ?2 AND revoked_at IS NULL
AND ((SELECT COUNT(*) FROM credential WHERE person_id = ?2 AND revoked_at IS NULL) > 1
  OR (EXISTS (SELECT 1 FROM person_identity WHERE person_id = ?2 AND revoked_at IS NULL)
    AND (NOT EXISTS (SELECT 1 FROM person_role WHERE person_id = ?2 AND role = 'admin')
      OR EXISTS (SELECT 1 FROM person_role r WHERE ${OTHER_SIGNED_IN_ADMIN_OF_2}))))`;

export interface ListedCredential {
  id: string;
  created_at: number;
  last_used_at: number | null;
}

export async function listedCredentialsOf(
  db: D1Database,
  personId: string,
): Promise<ListedCredential[]> {
  return (await db.prepare(LISTED).bind(personId).all<ListedCredential>()).results;
}

export function revokeCredential(
  db: D1Database,
  personId: string,
  id: string,
  now: number,
): D1PreparedStatement {
  return db.prepare(REVOKE_ONE).bind(id, personId, now);
}

export function insertCredential(
  db: D1Database,
  row: {
    id: string;
    personId: string;
    publicKey: Uint8Array;
    counter: number;
    transports: string[];
  },
  now: number,
): D1PreparedStatement {
  return db
    .prepare(INSERT)
    .bind(row.id, row.personId, row.publicKey, row.counter, JSON.stringify(row.transports), now);
}

/** Inserts the credential only while the session adding it is still live, so a revocation cannot be outrun. */
export function insertCredentialWhileLive(
  db: D1Database,
  row: Parameters<typeof insertCredential>[1],
  sessionHash: string,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(INSERT_LIVE)
    .bind(
      row.id,
      row.personId,
      row.publicKey,
      row.counter,
      JSON.stringify(row.transports),
      now,
      sessionHash,
    );
}

export async function activeCredential(db: D1Database, id: string): Promise<CredentialRow | null> {
  return db.prepare(ACTIVE).bind(id).first<CredentialRow>();
}

export async function activeCredentialsOf(
  db: D1Database,
  personId: string,
): Promise<CredentialRow[]> {
  return (await db.prepare(ACTIVE_OF).bind(personId).all<CredentialRow>()).results;
}

/** Stores the new counter only if the stored one is unchanged, so two racing assertions cannot both land. */
export function useCredential(
  db: D1Database,
  id: string,
  counter: { from: number; to: number },
  now: number,
): D1PreparedStatement {
  return db.prepare(USE).bind(id, counter.from, counter.to, now);
}

export function revokeCredentialsOf(
  db: D1Database,
  personId: string,
  now: number,
): D1PreparedStatement {
  return db.prepare(REVOKE_ALL).bind(personId, now);
}

/** D1 returns a BLOB as an ArrayBuffer or an array of bytes depending on the path; both become bytes. */
export function blobBytes(value: ArrayBuffer | number[]): Uint8Array<ArrayBuffer> {
  return value instanceof ArrayBuffer ? new Uint8Array(value) : Uint8Array.from(value);
}
