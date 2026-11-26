// A person ending every session of theirs but the one they are using, and every agent grant, audited.
import { auditedBatch, retryOnce } from '../db/audit';
import { liveGrantIdsOf } from '../db/agent-grants';
import type { Scope } from '../db/scope';
import { otherSessionCount } from '../db/sessions';
import { recordGrantRevocation, recordSessionRevocation } from './revoke';
import { keyedHash } from './tokens';

/** Returns how many sessions ended; with no session and no agent grant to end it writes nothing and records nothing. */
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
    if (ended === 0 && (await liveGrantIdsOf(db, personId)).length === 0) return;
    const batch = await auditedBatch(scope, db);
    await recordSessionRevocation(batch, db, personId, now, 'logoutOthers', keep);
    await recordGrantRevocation(batch, db, personId, now);
    await batch.run();
  });
  return ended;
}
