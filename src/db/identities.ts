// A person's identities at identity providers (ADR 0003): keyed on issuer and subject, never on an email, which is
// kept only to show an admin. Revoked, never deleted. A live pair belongs to one person, and a person holds one
// live identity per issuer.

export interface IdentityRow {
  id: string;
  person_id: string;
  provider: string;
  issuer: string;
  email: string | null;
  created_at: number;
  last_used_at: number | null;
}

const COLUMNS = 'id, person_id, provider, issuer, email, created_at, last_used_at';

const INSERT = `INSERT INTO person_identity (id, person_id, provider, issuer, subject, email, created_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`;

const OF_SUBJECT = `SELECT i.id, i.person_id, i.provider, i.issuer, i.email, i.created_at, i.last_used_at, p.offboarded_at
FROM person_identity i JOIN person p ON p.id = i.person_id
WHERE i.issuer = ?1 AND i.subject = ?2 AND i.revoked_at IS NULL`;

const LIVE_OF = `SELECT ${COLUMNS} FROM person_identity
WHERE person_id = ?1 AND revoked_at IS NULL ORDER BY created_at, id`;

const USE = 'UPDATE person_identity SET last_used_at = ?2 WHERE id = ?1 AND revoked_at IS NULL';

const REVOKE_ALL =
  'UPDATE person_identity SET revoked_at = ?2 WHERE person_id = ?1 AND revoked_at IS NULL';

const REVOKE_ONE =
  'UPDATE person_identity SET revoked_at = ?3 WHERE id = ?1 AND person_id = ?2 AND revoked_at IS NULL';

export interface SubjectIdentity extends IdentityRow {
  offboarded_at: number | null;
}

/** The live identity for an issuer and subject, with whether its person is offboarded, or null. */
export async function identityOfSubject(
  db: D1Database,
  issuer: string,
  subject: string,
): Promise<SubjectIdentity | null> {
  return db.prepare(OF_SUBJECT).bind(issuer, subject).first<SubjectIdentity>();
}

export async function liveIdentitiesOf(db: D1Database, personId: string): Promise<IdentityRow[]> {
  return (await db.prepare(LIVE_OF).bind(personId).all<IdentityRow>()).results;
}

/** Fails as a constraint when the pair is live for anyone or the person holds the issuer already, so the batch rolls back. */
export function insertIdentity(
  db: D1Database,
  row: {
    id: string;
    personId: string;
    provider: string;
    issuer: string;
    subject: string;
    email: string | null;
  },
  now: number,
): D1PreparedStatement {
  return db
    .prepare(INSERT)
    .bind(row.id, row.personId, row.provider, row.issuer, row.subject, row.email, now);
}

export function useIdentity(db: D1Database, id: string, now: number): D1PreparedStatement {
  return db.prepare(USE).bind(id, now);
}

export function revokeIdentitiesOf(
  db: D1Database,
  personId: string,
  now: number,
): D1PreparedStatement {
  return db.prepare(REVOKE_ALL).bind(personId, now);
}

export function revokeIdentity(
  db: D1Database,
  personId: string,
  id: string,
  now: number,
): D1PreparedStatement {
  return db.prepare(REVOKE_ONE).bind(id, personId, now);
}
