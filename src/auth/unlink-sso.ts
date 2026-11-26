// An admin unlinking one of a person's identities, audited, and with it every session and agent grant the person holds. The
// person keeps whatever else they sign in with; unlinking never touches a passkey. Like revoking credentials, it
// can leave a person with no way in, which an enrolment link then repairs.
import { auditedBatch, retryOnce } from '../db/audit';
import { liveIdentitiesOf, revokeIdentity } from '../db/identities';
import { requireAll, type Scope } from '../db/scope';
import { fail } from '../lib/errors';
import { recordGrantRevocation, recordSessionRevocation } from './revoke';

export async function unlinkSso(
  scope: Scope,
  db: D1Database,
  personId: string,
  identityId: string,
  now: number,
): Promise<void> {
  requireAll(scope);
  await retryOnce(async () => {
    const held = (await liveIdentitiesOf(db, personId)).map((i) => i.id);
    if (!held.includes(identityId)) fail('not_found');
    const batch = await auditedBatch(scope, db);
    await batch.record(
      revokeIdentity(db, personId, identityId, now),
      {
        at: now,
        action: 'people.unlinkSso',
        clientId: null,
        target: `person:${personId}`,
        before: { identities: [identityId] },
      },
      1,
    );
    await recordSessionRevocation(batch, db, personId, now, 'unlinkSso');
    await recordGrantRevocation(batch, db, personId, now);
    await batch.run();
  });
}
