// A person removing one of their own passkeys, audited, and with it every agent grant; the last passkey stays.
import { auditedBatch, retryOnce } from '../db/audit';
import { activeCredentialsOf, revokeCredential } from '../db/credentials';
import type { Scope } from '../db/scope';
import { fail } from '../lib/errors';
import { recordGrantRevocation } from './revoke';

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
    if (live.length < 2) fail('last_passkey');
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
    await recordGrantRevocation(batch, db, personId, now);
    await batch.run();
  });
}
