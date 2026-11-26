// Reinstating an offboarded person: the stamp is cleared and nothing else, so they have no passkey, session or link
// until an admin issues an enrolment link. Offboarding already revoked every credential, and an offboarded person
// can be given none.
import { auditedBatch, retryOnce } from '../db/audit';
import { personById, reinstateStatement } from '../db/people';
import { requireAll, type Scope } from '../db/scope';
import { fail } from '../lib/errors';

export async function reinstate(
  scope: Scope,
  db: D1Database,
  personId: string,
  now: number,
): Promise<void> {
  requireAll(scope);
  await retryOnce(async () => {
    const person = await personById(db, personId);
    if (!person || person.offboarded_at === null) fail('not_found');
    const batch = await auditedBatch(scope, db);
    await batch.record(
      reinstateStatement(db, personId, person.offboarded_at),
      {
        at: now,
        action: 'people.reinstate',
        clientId: null,
        target: `person:${personId}`,
        before: { offboarded_at: person.offboarded_at },
        after: { offboarded_at: null },
      },
      1,
    );
    await batch.run();
  });
}
