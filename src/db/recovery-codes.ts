// Recovery codes, stored as hashes, each used once (the plain batch waits ten minutes in pending_codes).

const INSERT_ONE =
  'INSERT INTO recovery_code (person_id, code_hash, created_at) VALUES (?1, ?2, ?3)';

const UNUSED =
  'SELECT 1 AS ok FROM recovery_code WHERE person_id = ?1 AND code_hash = ?2 AND used_at IS NULL';

const USE = `UPDATE recovery_code SET used_at = ?3
WHERE person_id = ?1 AND code_hash = ?2 AND used_at IS NULL`;

const UNUSED_COUNT =
  'SELECT count(*) AS n FROM recovery_code WHERE person_id = ?1 AND used_at IS NULL';

const CLOSE_ALL = 'UPDATE recovery_code SET used_at = ?2 WHERE person_id = ?1 AND used_at IS NULL';

export function insertCodes(
  db: D1Database,
  personId: string,
  hashes: readonly string[],
  now: number,
): D1PreparedStatement[] {
  return hashes.map((hash) => db.prepare(INSERT_ONE).bind(personId, hash, now));
}

export async function isUnusedCode(
  db: D1Database,
  personId: string,
  codeHash: string,
): Promise<boolean> {
  return (await db.prepare(UNUSED).bind(personId, codeHash).first()) !== null;
}

/** Marks a code used; changes no row if it was already used, which rolls the recovery batch back. */
export function useCode(
  db: D1Database,
  personId: string,
  codeHash: string,
  now: number,
): D1PreparedStatement {
  return db.prepare(USE).bind(personId, codeHash, now);
}

export async function unusedCodeCount(db: D1Database, personId: string): Promise<number> {
  return (await db.prepare(UNUSED_COUNT).bind(personId).first<{ n: number }>())?.n ?? 0;
}

/** Retires every unused code of a person by marking it used now. */
export function closeCodesOf(db: D1Database, personId: string, now: number): D1PreparedStatement {
  return db.prepare(CLOSE_ALL).bind(personId, now);
}
