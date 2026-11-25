// Offboarding: the person is stamped offboarded and every credential, session, recovery code and open link
// is revoked in the same batch, each with its own event. The last active admin cannot be offboarded.
import { auditedBatch, retryOnce } from '../db/audit';
import { isLastAdmin, offboardStatement } from '../db/admins';
import { personById } from '../db/people';
import { requireAll, type Scope } from '../db/scope';
import { fail } from '../lib/errors';
import { recordRevocations } from './revoke';

export async function offboard(
  scope: Scope,
  db: D1Database,
  personId: string,
  now: number,
): Promise<void> {
  requireAll(scope);
  await retryOnce(async () => {
    const person = await personById(db, personId);
    if (!person || person.offboarded_at !== null) fail('not_found');
    if (await isLastAdmin(db, personId)) fail('last_admin');
    const batch = await auditedBatch(scope, db);
    await batch.record(
      offboardStatement(db, personId, now),
      {
        at: now,
        action: 'people.offboard',
        clientId: null,
        target: `person:${personId}`,
        before: { offboarded_at: null },
        after: { offboarded_at: now },
      },
      1,
    );
    await recordRevocations(batch, db, personId, now);
    await batch.run();
  });
}
