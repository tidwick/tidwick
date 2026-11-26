// A person removing one of their own passkeys, audited. Their last passkey goes only if they keep a linked identity, and not at all if it makes them the last admin who can sign in (ADR 0003).
import { auditedBatch, retryOnce } from '../db/audit';
import { isLastAdmin } from '../db/admins';
import { activeCredentialsOf, revokeCredential } from '../db/credentials';
import { liveIdentitiesOf } from '../db/identities';
import type { Scope } from '../db/scope';
import { fail } from '../lib/errors';

export async function revokeOwnPasskey(
  scope: Scope,
  db: D1Database,
  personId: string,
  credentialId: string,
  now: number,
): Promise<void> {
  await retryOnce(async () => {
    const live = (await activeCredentialsOf(db, personId)).map((c) => c.id);
    if (!live.includes(credentialId)) fail('not_found');
    if (live.length < 2) {
      if ((await liveIdentitiesOf(db, personId)).length === 0) fail('last_method');
      if (await isLastAdmin(db, personId)) fail('last_admin');
    }
    const batch = await auditedBatch(scope, db);
    await batch.record(
      revokeCredential(db, personId, credentialId, now),
      {
        at: now,
        action: 'auth.revokePasskey',
        clientId: null,
        target: `person:${personId}`,
        before: { credentials: [credentialId] },
      },
      1,
    );
    await batch.run();
  });
}
