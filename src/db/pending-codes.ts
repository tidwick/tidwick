// The plain recovery codes a person has just made, held briefly so a reload still shows them.

export const PENDING_CODES_MS = 10 * 60 * 1000;

const PUT = `INSERT INTO pending_codes (person_id, codes, expires_at) VALUES (?1, ?2, ?3)
ON CONFLICT (person_id) DO UPDATE SET codes = excluded.codes, expires_at = excluded.expires_at`;

export function putPendingCodes(
  db: D1Database,
  personId: string,
  codes: readonly string[],
  now: number,
): D1PreparedStatement {
  return db.prepare(PUT).bind(personId, codes.join('\n'), now + PENDING_CODES_MS);
}

/** The unexpired codes waiting for acknowledgement, or none. */
export async function pendingCodesOf(
  db: D1Database,
  personId: string,
  now: number,
): Promise<string[]> {
  const row = await db
    .prepare('SELECT codes FROM pending_codes WHERE person_id = ?1 AND expires_at > ?2')
    .bind(personId, now)
    .first<{ codes: string }>();
  return row ? row.codes.split('\n') : [];
}

export async function clearPendingCodes(db: D1Database, personId: string): Promise<void> {
  await db.prepare('DELETE FROM pending_codes WHERE person_id = ?1').bind(personId).run();
}
