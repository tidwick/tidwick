// A person ending every session of theirs but the one they are using, audited.
import { auditedBatch, retryOnce } from '../db/audit';
import type { Scope } from '../db/scope';
import { otherSessionCount, revokeOtherSessions } from '../db/sessions';
import { keyedHash } from './tokens';

/** Returns how many sessions ended; with no other session to end it writes nothing and records nothing. */
export async function logoutOthers(
  scope: Scope,
  db: D1Database,
  secret: string,
  personId: string,
  currentRawId: string,
  now: number,
): Promise<number> {
  const keep = await keyedHash(secret, 'session', currentRawId);
  let ended = 0;
  await retryOnce(async () => {
    ended = await otherSessionCount(db, personId, keep, now);
    if (ended === 0) return;
    const batch = await auditedBatch(scope, db);
    await batch.record(
      revokeOtherSessions(db, personId, keep, now),
      {
        at: now,
        action: 'auth.logoutOthers',
        clientId: null,
        target: `person:${personId}`,
        before: { sessions: ended },
      },
      ended,
    );
    await batch.run();
  });
  return ended;
}
