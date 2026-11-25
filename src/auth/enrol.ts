// Enrolment: an admin issues a single-use 24-hour link, stored as a hash; its holder registers a passkey.
import { auditedBatch, retryOnce, retryWhileOpen, type AuditedBatch } from '../db/audit';
import { activeCredentialsOf, insertCredential } from '../db/credentials';
import {
  closeEnrolmentsOf,
  insertEnrolment,
  openEnrolment,
  openEnrolmentCount,
  useEnrolment,
} from '../db/enrolments';
import { personById } from '../db/people';
import { closeCodesOf, insertCodes } from '../db/recovery-codes';
import { ceremonyScope, requireAll, type Scope } from '../db/scope';
import type { AuthEnv } from '../lib/env';
import { fail } from '../lib/errors';
import { storeChallenge, takeChallenge } from './challenge';
import { storedCredential, userHandle } from './passkeys';
import { freshCodes } from './recovery-codes';
import { newSession } from './session';
import { keyedHash, randomToken } from './tokens';
import {
  registrationOptions,
  verifyRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type RegistrationResponseJSON,
} from './webauthn';

export const ENROLMENT_MS = 24 * 60 * 60 * 1000;

/** Adds a new link for a person to `batch` under `action`, audited; returns the raw token, which is never stored. */
export async function recordEnrolment(
  batch: AuditedBatch,
  db: D1Database,
  secret: string,
  personId: string,
  action: 'people.issueEnrolment' | 'people.reenrol',
  now: number,
): Promise<string> {
  const token = randomToken();
  const expiresAt = now + ENROLMENT_MS;
  const tokenHash = await keyedHash(secret, 'enrol', token);
  await batch.record(
    insertEnrolment(db, { tokenHash, personId, expiresAt }),
    {
      at: now,
      action,
      clientId: null,
      target: `person:${personId}`,
      after: { expires_at: expiresAt },
    },
    1,
  );
  return token;
}

/**
 * Adds the close of every link the person holds open to `batch`, audited against the count read before it, and
 * nothing when none is open. Two links issued at the same moment can both stay open; using either closes the other.
 */
export async function recordClosedLinks(
  batch: AuditedBatch,
  db: D1Database,
  personId: string,
  now: number,
  open: number,
): Promise<void> {
  if (open === 0) return;
  await batch.record(
    closeEnrolmentsOf(db, personId, now),
    {
      at: now,
      action: 'people.revokeEnrolments',
      clientId: null,
      target: `person:${personId}`,
      before: { open },
    },
    open,
  );
}

/**
 * Issues an enrolment link for an active person and closes any link issued before it, so only the newest one
 * works; the caller shows or mails `/enrol/<token>` once.
 */
export async function issueEnrolment(
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
    const open = await openEnrolmentCount(db, personId, now);
    const batch = await auditedBatch(scope, db);
    await recordClosedLinks(batch, db, personId, now, open);
    const token = await recordEnrolment(batch, db, secret, personId, 'people.issueEnrolment', now);
    await batch.run();
    return token;
  });
}

async function openFor(deps: AuthEnv, token: string, now: number) {
  const tokenHash = await keyedHash(deps.secret, 'enrol', token);
  const enrolment = await openEnrolment(deps.db, tokenHash, now);
  if (!enrolment) fail('enrolment_invalid');
  return { tokenHash, personId: enrolment.person_id };
}

/** Registration options for the holder of an open link; an unknown, used or expired link is `enrolment_invalid`. */
export async function enrolOptions(
  deps: AuthEnv,
  token: string,
  now: number,
): Promise<{ options: PublicKeyCredentialCreationOptionsJSON; challengeId: string }> {
  const { personId } = await openFor(deps, token, now);
  const person = await personById(deps.db, personId);
  if (!person) fail('enrolment_invalid');
  const existing = (await activeCredentialsOf(deps.db, personId)).map(storedCredential);
  const user = { id: userHandle(personId), name: person.email, displayName: person.name };
  const options = await registrationOptions(deps.rp, user, existing);
  const challengeId = await storeChallenge(deps, 'enrol', personId, options.challenge, now);
  return { options, challengeId };
}

/**
 * Registers the passkey and uses the link in one audited batch, which also closes the person's other open links,
 * replaces their recovery codes and opens a session, so a second link cannot enrol after this one. Returns the
 * session id and the ten codes, shown to the holder once.
 */
export async function completeEnrolment(
  deps: AuthEnv,
  token: string,
  challengeId: string | null,
  response: RegistrationResponseJSON,
  now: number,
): Promise<{ sessionId: string; codes: string[] }> {
  const { tokenHash, personId } = await openFor(deps, token, now);
  const challenge = await takeChallenge(deps, challengeId, 'enrol', now);
  if (!challenge || challenge.personId !== personId) fail('passkey_failed');
  const credential = await verifyRegistration(deps.rp, response, challenge.challenge);
  if (!credential) fail('passkey_failed');
  const { codes, hashes } = await freshCodes(deps.secret);
  const session = await newSession(deps.db, deps.secret, personId, now);
  const { db } = deps;
  await retryWhileOpen(
    async () => {
      const others = (await openEnrolmentCount(db, personId, now)) - 1;
      const batch = await auditedBatch(ceremonyScope(personId), db);
      await batch.record(
        useEnrolment(db, tokenHash, personId, now),
        {
          at: now,
          action: 'auth.enrol',
          clientId: null,
          target: `person:${personId}`,
          after: { credential: credential.id, recovery_codes: hashes.length },
        },
        1,
      );
      await recordClosedLinks(batch, db, personId, now, others);
      const transports = credential.transports ?? [];
      batch.also(insertCredential(db, { ...credential, personId, transports }, now));
      batch.also(closeCodesOf(db, personId, now));
      for (const insert of insertCodes(db, personId, hashes, now)) batch.also(insert);
      batch.also(session.statement);
      await batch.run();
    },
    async () => (await openEnrolment(db, tokenHash, now)) !== null,
    () => fail('enrolment_invalid'),
  );
  return { sessionId: session.rawId, codes };
}
