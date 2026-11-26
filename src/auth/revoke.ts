// Revoking a person's access: every credential, identity, session, unused recovery code, open link and agent grant, each audited.
import { liveGrantIdsOf, revokeGrantsOf } from '../db/agent-grants';
import { isLastAdmin } from '../db/admins';
import { auditedBatch, retryOnce, type AuditedBatch } from '../db/audit';
import {
  activeCredentialsOf,
  revokeCredentialsExcept,
  revokeCredentialsKeepingAdmin,
  revokeCredentialsOf,
} from '../db/credentials';
import { closeEnrolmentsOf, openEnrolmentCount } from '../db/enrolments';
import { liveIdentitiesOf, revokeIdentitiesOf } from '../db/identities';
import { personById } from '../db/people';
import { closeCodesOf, unusedCodeCount } from '../db/recovery-codes';
import { requireAll, type Scope } from '../db/scope';
import {
  liveSessionCount,
  otherSessionCount,
  revokeOtherSessions,
  revokeSessionsOf,
} from '../db/sessions';
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

/**
 * Adds the end of a person's live sessions to `batch`, with an event only when there are sessions to end, and returns
 * how many. With `keepIdHash` the holder's own session stays (`auth.logoutOthers`); without it every session ends
 * (`people.revokeSessions`). `cause` names the action it belongs to, so the log reads as part of that action.
 */
export async function recordSessionRevocation(
  batch: AuditedBatch,
  db: D1Database,
  personId: string,
  now: number,
  cause: string,
  keepIdHash?: string,
): Promise<number> {
  const sessions =
    keepIdHash === undefined
      ? await liveSessionCount(db, personId, now)
      : await otherSessionCount(db, personId, keepIdHash, now);
  if (sessions === 0) return 0;
  await batch.record(
    keepIdHash === undefined
      ? revokeSessionsOf(db, personId, now)
      : revokeOtherSessions(db, personId, keepIdHash, now),
    {
      at: now,
      action: keepIdHash === undefined ? 'people.revokeSessions' : 'auth.logoutOthers',
      clientId: null,
      target: `person:${personId}`,
      before: { sessions, cause },
    },
    sessions,
  );
  return sessions;
}

/**
 * Adds a person's identities' revocation to `batch`, with a `people.unlinkSso` event only when there are identities
 * to revoke, so a person who never used single sign-on adds no event.
 */
export async function recordIdentityRevocation(
  batch: AuditedBatch,
  db: D1Database,
  personId: string,
  now: number,
): Promise<void> {
  const identities = (await liveIdentitiesOf(db, personId)).map((i) => i.id);
  if (identities.length === 0) return;
  await batch.record(
    revokeIdentitiesOf(db, personId, now),
    {
      at: now,
      action: 'people.unlinkSso',
      clientId: null,
      target: `person:${personId}`,
      before: { identities },
    },
    identities.length,
  );
}

/**
 * A recovery has earned the person a new passkey (`keepCredentialId`, inserted earlier in `batch`): adds the
 * revocation of every other passkey, every session (the recovery one too, so it must precede the new session's
 * insert), every linked identity and every agent grant. Whoever held the lost device holds none of it afterwards.
 */
export async function recordRecoverySupersession(
  batch: AuditedBatch,
  db: D1Database,
  personId: string,
  keepCredentialId: string,
  now: number,
): Promise<void> {
  const credentials = (await activeCredentialsOf(db, personId)).map((c) => c.id);
  if (credentials.length > 0)
    await batch.record(
      revokeCredentialsExcept(db, personId, keepCredentialId, now),
      {
        at: now,
        action: 'people.revokeCredentials',
        clientId: null,
        target: `person:${personId}`,
        before: { credentials },
      },
      credentials.length,
    );
  await recordSessionRevocation(batch, db, personId, now, 'recovery');
  await recordIdentityRevocation(batch, db, personId, now);
  await recordGrantRevocation(batch, db, personId, now);
}

/** Adds every revocation to `batch`, each followed by an event that lands only if it changed what was read. */
export async function recordRevocations(
  batch: AuditedBatch,
  db: D1Database,
  personId: string,
  now: number,
  keepLastAdmin = false,
): Promise<void> {
  const credentials = (await activeCredentialsOf(db, personId)).map((c) => c.id);
  const sessions = await liveSessionCount(db, personId, now);
  const codes = await unusedCodeCount(db, personId);
  const links = await openEnrolmentCount(db, personId, now);
  const event = { at: now, clientId: null, target: `person:${personId}` };
  await batch.record(
    (keepLastAdmin ? revokeCredentialsKeepingAdmin : revokeCredentialsOf)(db, personId, now),
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
  await recordIdentityRevocation(batch, db, personId, now);
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

/**
 * Re-enrolment: revokes all of a person's access and issues one new link in the same batch; returns its token.
 * The last admin who can sign in is refused as `last_admin`, as offboarding does: it would leave no one to sign in.
 */
export async function reenrol(
  scope: Scope,
  db: D1Database,
  secret: string,
  personId: string,
  now: number,
): Promise<string> {
  requireAll(scope);
  return retryOnce(async () => {
    const person = await personById(db, personId);
    if (!person || person.offboarded_at !== null) fail('not_found');
    if (await isLastAdmin(db, personId)) fail('last_admin');
    const batch = await auditedBatch(scope, db);
    await recordRevocations(batch, db, personId, now, true);
    const token = await recordEnrolment(batch, db, secret, personId, 'people.reenrol', now);
    await batch.run();
    return token;
  });
}
