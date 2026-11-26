// The plain recovery codes a person has just made, held briefly so a reload still shows them.
// The row is bound to the creating session by a keyed hash, and expired rows are pruned on every write and read.
import { keyedHash } from '../auth/tokens';

export const PENDING_CODES_MS = 10 * 60 * 1000;

const PUT = `INSERT INTO pending_codes (person_id, session_hash, codes, expires_at) VALUES (?1, ?2, ?3, ?4)
ON CONFLICT (person_id) DO UPDATE SET session_hash = excluded.session_hash, codes = excluded.codes,
  expires_at = excluded.expires_at`;

/** Statements for one batch: drop every expired row of anyone, then store this person's codes. */
export function putPendingCodes(
  db: D1Database,
  personId: string,
  sessionHash: string,
  codes: readonly string[],
  now: number,
): D1PreparedStatement[] {
  return [
    db.prepare('DELETE FROM pending_codes WHERE expires_at <= ?1').bind(now),
    db.prepare(PUT).bind(personId, sessionHash, codes.join('\n'), now + PENDING_CODES_MS),
  ];
}

/** The unexpired codes this session made and has not acknowledged, or none; the caller's expired row is deleted. */
export async function pendingCodesOf(
  db: D1Database,
  secret: string,
  session: { readonly personId: string; readonly rawId: string },
  now: number,
): Promise<string[]> {
  await db
    .prepare('DELETE FROM pending_codes WHERE person_id = ?1 AND expires_at <= ?2')
    .bind(session.personId, now)
    .run();
  const row = await db
    .prepare('SELECT codes FROM pending_codes WHERE person_id = ?1 AND session_hash = ?2')
    .bind(session.personId, await keyedHash(secret, 'pending', session.rawId))
    .first<{ codes: string }>();
  return row ? row.codes.split('\n') : [];
}

export async function clearPendingCodes(db: D1Database, personId: string): Promise<void> {
  await db.prepare('DELETE FROM pending_codes WHERE person_id = ?1').bind(personId).run();
}
