// Ceremony challenges: stored under the hash of their id, consumed once by a single UPDATE … RETURNING.

export type ChallengePurpose = 'enrol' | 'login' | 'step_up' | 'add';

export interface ChallengeRow {
  challenge: string;
  person_id: string | null;
}

const INSERT = `INSERT INTO auth_challenge (id_hash, purpose, person_id, challenge, expires_at)
VALUES (?1, ?2, ?3, ?4, ?5)`;

const PRUNE = 'DELETE FROM auth_challenge WHERE expires_at < ?1';

const CONSUME = `UPDATE auth_challenge SET used_at = ?3
WHERE id_hash = ?1 AND purpose = ?2 AND used_at IS NULL AND expires_at > ?3
RETURNING challenge, person_id`;

/**
 * Stores a challenge and drops every expired one, which nothing reads again; the prune walks the `expires_at`
 * index, so it reads the rows it deletes and not the table.
 */
export async function insertChallenge(
  db: D1Database,
  row: {
    idHash: string;
    purpose: ChallengePurpose;
    personId: string | null;
    challenge: string;
    expiresAt: number;
  },
  now: number,
): Promise<void> {
  await db.batch([
    db.prepare(PRUNE).bind(now),
    db.prepare(INSERT).bind(row.idHash, row.purpose, row.personId, row.challenge, row.expiresAt),
  ]);
}

/** Marks the challenge used and returns it, or null when it is unknown, used, expired or for another purpose. */
export async function consumeChallenge(
  db: D1Database,
  idHash: string,
  purpose: ChallengePurpose,
  now: number,
): Promise<ChallengeRow | null> {
  return db.prepare(CONSUME).bind(idHash, purpose, now).first<ChallengeRow>();
}
