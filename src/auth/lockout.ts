// Recovery lockout per email hash: five consecutive failures lock for 1, 2, 4 and on up to 60 minutes.
import { auditedBatch, retryOnce } from '../db/audit';
import { personById } from '../db/people';
import { attemptOf, clearAttempts, countFailure, lockAttempts } from '../db/recovery-attempts';
import { ceremonyScope, type Scope } from '../db/scope';
import { fail } from '../lib/errors';
import { keyedHash } from './tokens';

export const LOCK_AFTER = 5;
export const FIRST_LOCK_MS = 60 * 1000;
export const MAX_LOCK_MS = 60 * 60 * 1000;

/** The lock earned by a run of failures: none below five, then 1 minute doubling per failure, capped at 60. */
export function lockDuration(failures: number): number {
  if (failures < LOCK_AFTER) return 0;
  return Math.min(MAX_LOCK_MS, FIRST_LOCK_MS * 2 ** Math.min(failures - LOCK_AFTER, 6));
}

export async function emailHash(secret: string, email: string): Promise<string> {
  return keyedHash(secret, 'email', email.trim().toLowerCase());
}

export async function isLocked(db: D1Database, hash: string, now: number): Promise<boolean> {
  const row = await attemptOf(db, hash);
  return row !== null && row.locked_until !== null && row.locked_until > now;
}

/**
 * Counts a failure and, on reaching a lock, stamps it. Only a known person's first lock in a run of failures
 * is audited: later locks in the run only extend it, and an unknown email has nobody to audit, so neither
 * grows the append-only log. Both paths read the head and send one batch, so they cost the same.
 */
export async function recordFailure(
  db: D1Database,
  hash: string,
  now: number,
  known: boolean,
): Promise<void> {
  const failures = await countFailure(db, hash, now);
  const lockMs = lockDuration(failures);
  if (lockMs === 0) return;
  const until = now + lockMs;
  await retryOnce(async () => {
    const batch = await auditedBatch(ceremonyScope(null), db);
    const lock = lockAttempts(db, hash, failures, until);
    if (known && failures === LOCK_AFTER) {
      await batch.record(
        lock,
        {
          at: now,
          action: 'auth.recoveryLocked',
          clientId: null,
          target: `recovery:${hash}`,
          after: { failures, locked_until: until },
        },
        1,
      );
    } else {
      batch.also(lock);
    }
    await batch.run();
  });
}

/** Clears the counter after a successful recovery, inside that recovery's batch. */
export function clearFailures(db: D1Database, hash: string): D1PreparedStatement {
  return clearAttempts(db, hash);
}

/** The admin reset: clears a person's recovery counter and lock, audited; returns whether there was one. */
export async function unlockRecovery(
  scope: Scope,
  db: D1Database,
  secret: string,
  personId: string,
  now: number,
): Promise<boolean> {
  const person = await personById(db, personId);
  if (!person) fail('not_found');
  const hash = await emailHash(secret, person.email);
  return retryOnce(async () => {
    const before = await attemptOf(db, hash);
    if (!before) return false;
    const batch = await auditedBatch(scope, db);
    await batch.record(
      clearAttempts(db, hash),
      { at: now, action: 'people.unlock', clientId: null, target: `person:${personId}`, before },
      1,
    );
    await batch.run();
    return true;
  });
}
