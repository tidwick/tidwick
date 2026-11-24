// Enrolment links: one person each, stored as the hash of the token, used once, open for 24 hours.

export interface EnrolmentRow {
  person_id: string;
  expires_at: number;
}

const INSERT = 'INSERT INTO enrolment (token_hash, person_id, expires_at) VALUES (?1, ?2, ?3)';

const OPEN = `SELECT e.person_id, e.expires_at
FROM enrolment e JOIN person p ON p.id = e.person_id
WHERE e.token_hash = ?1 AND e.used_at IS NULL AND e.expires_at > ?2 AND p.offboarded_at IS NULL`;

const USE = `UPDATE enrolment SET used_at = ?3
WHERE token_hash = ?1 AND person_id = ?2 AND used_at IS NULL AND expires_at > ?3`;

const OPEN_COUNT =
  'SELECT count(*) AS n FROM enrolment WHERE person_id = ?1 AND used_at IS NULL AND expires_at > ?2';

const CLOSE_ALL = `UPDATE enrolment SET used_at = ?2
WHERE person_id = ?1 AND used_at IS NULL AND expires_at > ?2`;

export function insertEnrolment(
  db: D1Database,
  row: { tokenHash: string; personId: string; expiresAt: number },
): D1PreparedStatement {
  return db.prepare(INSERT).bind(row.tokenHash, row.personId, row.expiresAt);
}

/** The enrolment behind a token hash while it is unused, unexpired and its person active; else null. */
export async function openEnrolment(
  db: D1Database,
  tokenHash: string,
  now: number,
): Promise<EnrolmentRow | null> {
  return db.prepare(OPEN).bind(tokenHash, now).first<EnrolmentRow>();
}

/** Marks the link used; changes no row once it is used or expired, which rolls the enrolment batch back. */
export function useEnrolment(
  db: D1Database,
  tokenHash: string,
  personId: string,
  now: number,
): D1PreparedStatement {
  return db.prepare(USE).bind(tokenHash, personId, now);
}

export async function openEnrolmentCount(
  db: D1Database,
  personId: string,
  now: number,
): Promise<number> {
  return (await db.prepare(OPEN_COUNT).bind(personId, now).first<{ n: number }>())?.n ?? 0;
}

/** Closes every open link for a person by marking it used now. */
export function closeEnrolmentsOf(
  db: D1Database,
  personId: string,
  now: number,
): D1PreparedStatement {
  return db.prepare(CLOSE_ALL).bind(personId, now);
}
