// Revoking a person's access: every credential, session, unused recovery code, open link and agent grant, each audited.
import { liveGrantIdsOf, revokeGrantsOf } from '../db/agent-grants';
import { auditedBatch, retryOnce, type AuditedBatch } from '../db/audit';
import { activeCredentialsOf, revokeCredentialsOf } from '../db/credentials';
import { closeEnrolmentsOf, openEnrolmentCount } from '../db/enrolments';
import { personById } from '../db/people';
import { closeCodesOf, unusedCodeCount } from '../db/recovery-codes';
import { requireAll, type Scope } from '../db/scope';
import { liveSessionCount, revokeSessionsOf } from '../db/sessions';
import { fail } from '../lib/errors';
import { recordEnrolment } from './enrol';

/**
 * Adds a person's agent grants' revocation to `batch`, with an `agents.revoke` event only when there are grants to
 * revoke. Every path that cuts a person's own access calls it, so an agent never outlives the sign-in behind it.
 */
export async function recordGrantRevocation(
  batch: AuditedBatch,
  db: D1Database,
  personId: string,
  now: number,
): Promise<void> {
  const grants = await liveGrantIdsOf(db, personId);
  if (grants.length === 0) return;
  await batch.record(
    revokeGrantsOf(db, personId, now),
    {
      at: now,
      action: 'agents.revoke',
      clientId: null,
      target: `person:${personId}`,
      before: { grants },
    },
    grants.length,
  );
}

/** Adds the four revocations to `batch`, each followed by an event that lands only if it changed what was read. */
export async function recordRevocations(
  batch: AuditedBatch,
  db: D1Database,
  personId: string,
  now: number,
): Promise<void> {
  const credentials = (await activeCredentialsOf(db, personId)).map((c) => c.id);
  const sessions = await liveSessionCount(db, personId, now);
  const codes = await unusedCodeCount(db, personId);
  const links = await openEnrolmentCount(db, personId, now);
  const event = { at: now, clientId: null, target: `person:${personId}` };
  await batch.record(
    revokeCredentialsOf(db, personId, now),
    { ...event, action: 'people.revokeCredentials', before: { credentials } },
    credentials.length,
  );
  await batch.record(
    revokeSessionsOf(db, personId, now),
    { ...event, action: 'people.revokeSessions', before: { sessions } },
    sessions,
  );
  await batch.record(
    closeCodesOf(db, personId, now),
    { ...event, action: 'people.revokeCodes', before: { unused: codes } },
    codes,
  );
  await batch.record(
    closeEnrolmentsOf(db, personId, now),
    { ...event, action: 'people.revokeEnrolments', before: { open: links } },
    links,
  );
  await recordGrantRevocation(batch, db, personId, now);
}

/** Revokes all of a person's access, as offboarding does; one retry if a concurrent write moved the counts. */
export async function revokeAccess(
  scope: Scope,
  db: D1Database,
  personId: string,
  now: number,
): Promise<void> {
  await retryOnce(async () => {
    const batch = await auditedBatch(scope, db);
    await recordRevocations(batch, db, personId, now);
    await batch.run();
  });
}

/** Re-enrolment: revokes all of a person's access and issues one new link in the same batch; returns its token. */
export async function reenrol(
  scope: Scope,
  db: D1Database,
  secret: string,
  personId: string,
  now: number,
): Promise<string> {
  requireAll(scope);
  const person = await personById(db, personId);
  if (!person || person.offboarded_at !== null) fail('not_found');
  return retryOnce(async () => {
    const batch = await auditedBatch(scope, db);
    await recordRevocations(batch, db, personId, now);
    const token = await recordEnrolment(batch, db, secret, personId, 'people.reenrol', now);
    await batch.run();
    return token;
  });
}
