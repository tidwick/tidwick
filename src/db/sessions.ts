// Sessions, stored under the hash of their id. Idle and absolute expiry are decided in src/auth/session.ts.

export interface SessionRow {
  person_id: string;
  created_at: number;
  seen_at: number;
  expires_at: number;
  step_up_at: number;
  must_enrol: number;
  name: string;
  offboarded_at: number | null;
}

const INSERT = `INSERT INTO session (id_hash, person_id, created_at, seen_at, expires_at, step_up_at, must_enrol)
VALUES (?1, ?2, ?3, ?3, ?4, ?6, ?5)`;

const LIVE = `SELECT s.person_id, s.created_at, s.seen_at, s.expires_at, s.step_up_at, s.must_enrol, p.name, p.offboarded_at
FROM session s JOIN person p ON p.id = s.person_id
WHERE s.id_hash = ?1 AND s.revoked_at IS NULL`;

const TOUCH = 'UPDATE session SET seen_at = ?2 WHERE id_hash = ?1 AND revoked_at IS NULL';

const REVOKE = 'UPDATE session SET revoked_at = ?2 WHERE id_hash = ?1 AND revoked_at IS NULL';

const STEP_UP = 'UPDATE session SET step_up_at = ?2 WHERE id_hash = ?1 AND revoked_at IS NULL';

const LIVE_COUNT = `SELECT count(*) AS n FROM session
WHERE person_id = ?1 AND revoked_at IS NULL AND expires_at > ?2`;

const OTHERS_COUNT = `SELECT count(*) AS n FROM session
WHERE person_id = ?1 AND id_hash <> ?2 AND revoked_at IS NULL AND expires_at > ?3`;

const REVOKE_OTHERS = `UPDATE session SET revoked_at = ?3
WHERE person_id = ?1 AND id_hash <> ?2 AND revoked_at IS NULL AND expires_at > ?3`;

const REVOKE_ALL = `UPDATE session SET revoked_at = ?2
WHERE person_id = ?1 AND revoked_at IS NULL AND expires_at > ?2`;

export function insertSession(
  db: D1Database,
  row: {
    idHash: string;
    personId: string;
    expiresAt: number;
    mustEnrol: boolean;
    /** When the last passkey assertion counted; the expiry for a demo session, which never asks for one. */
    stepUpAt: number;
  },
  now: number,
): D1PreparedStatement {
  return db
    .prepare(INSERT)
    .bind(row.idHash, row.personId, now, row.expiresAt, row.mustEnrol ? 1 : 0, row.stepUpAt);
}

/** The unrevoked session behind an id hash with its person's name and offboarding stamp, or null. */
export async function liveSession(db: D1Database, idHash: string): Promise<SessionRow | null> {
  return db.prepare(LIVE).bind(idHash).first<SessionRow>();
}

export async function touchSession(db: D1Database, idHash: string, now: number): Promise<void> {
  await db.prepare(TOUCH).bind(idHash, now).run();
}

export function revokeSession(db: D1Database, idHash: string, now: number): D1PreparedStatement {
  return db.prepare(REVOKE).bind(idHash, now);
}

/** Stamps a fresh passkey assertion on a live session. */
export function stepUpSession(db: D1Database, idHash: string, now: number): D1PreparedStatement {
  return db.prepare(STEP_UP).bind(idHash, now);
}

export async function liveSessionCount(
  db: D1Database,
  personId: string,
  now: number,
): Promise<number> {
  return (await db.prepare(LIVE_COUNT).bind(personId, now).first<{ n: number }>())?.n ?? 0;
}

/** Revokes every unexpired session of a person; expired ones are already dead and stay as they are. */
export function revokeSessionsOf(
  db: D1Database,
  personId: string,
  now: number,
): D1PreparedStatement {
  return db.prepare(REVOKE_ALL).bind(personId, now);
}

export async function otherSessionCount(
  db: D1Database,
  personId: string,
  keepIdHash: string,
  now: number,
): Promise<number> {
  return (
    (await db.prepare(OTHERS_COUNT).bind(personId, keepIdHash, now).first<{ n: number }>())?.n ?? 0
  );
}

/** Revokes every unexpired session of a person except the one named, which keeps its holder signed in. */
export function revokeOtherSessions(
  db: D1Database,
  personId: string,
  keepIdHash: string,
  now: number,
): D1PreparedStatement {
  return db.prepare(REVOKE_OTHERS).bind(personId, keepIdHash, now);
}
