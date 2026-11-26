// Recovery failure counters per email hash, for known and unknown emails alike.

export interface AttemptRow {
  failures: number;
  locked_until: number | null;
}

const READ = 'SELECT failures, locked_until FROM recovery_attempt WHERE email_hash = ?1';

const FAIL = `INSERT INTO recovery_attempt (email_hash, failures, failed_at) VALUES (?1, 1, ?2)
ON CONFLICT (email_hash) DO UPDATE SET failures = failures + 1, failed_at = excluded.failed_at
RETURNING failures`;

/** Counters a day past their last failure and not locked: any email tried, known or not, leaves one. */
const PRUNE =
  'DELETE FROM recovery_attempt WHERE failed_at < ?1 AND coalesce(locked_until, 0) <= ?2';

/** Fixed: housekeeping for the failure counters, no policy; the lockout itself is in `lockout.ts`. */
export const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;

const LOCK = `UPDATE recovery_attempt SET locked_until = max(coalesce(locked_until, 0), ?2)
WHERE email_hash = ?1 AND failures >= ?3`;

const CLEAR = 'DELETE FROM recovery_attempt WHERE email_hash = ?1';

export async function attemptOf(db: D1Database, emailHash: string): Promise<AttemptRow | null> {
  return db.prepare(READ).bind(emailHash).first<AttemptRow>();
}

/**
 * Prunes stale counters, so the table holds only emails tried in the last day, then counts one more failure and
 * returns the new consecutive total. Known and unknown emails send the same two statements.
 */
export async function countFailure(
  db: D1Database,
  emailHash: string,
  now: number,
): Promise<number> {
  await db
    .prepare(PRUNE)
    .bind(now - PRUNE_AFTER_MS, now)
    .run();
  return (await db.prepare(FAIL).bind(emailHash, now).first<{ failures: number }>())?.failures ?? 1;
}

/** Locks until at least `until` while the count is still `failures` or more, so a racing failure cannot void it. */
export function lockAttempts(
  db: D1Database,
  emailHash: string,
  failures: number,
  until: number,
): D1PreparedStatement {
  return db.prepare(LOCK).bind(emailHash, until, failures);
}

export function clearAttempts(db: D1Database, emailHash: string): D1PreparedStatement {
  return db.prepare(CLEAR).bind(emailHash);
}
