// A signed-in person adds a passkey. From a recovery session, the new passkey replaces that session with a full one.
import { auditedBatch, retryOnce } from '../db/audit';
import { activeCredentialsOf, insertCredentialWhileLive } from '../db/credentials';
import { personById } from '../db/people';
import { ceremonyScope } from '../db/scope';
import type { AuthEnv } from '../lib/env';
import { fail } from '../lib/errors';
import { storeChallenge, takeChallenge } from './challenge';
import { storedCredential, userHandle } from './passkeys';
import { recordRecoverySupersession } from './revoke';
import { newSession, type Session } from './session';
import { keyedHash } from './tokens';
import {
  registrationOptions,
  verifyRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type RegistrationResponseJSON,
} from './webauthn';

export async function addPasskeyOptions(
  deps: AuthEnv,
  session: Session,
  now: number,
): Promise<{ options: PublicKeyCredentialCreationOptionsJSON; challengeId: string }> {
  const person = await personById(deps.db, session.personId);
  if (!person) fail('unauthenticated');
  const existing = (await activeCredentialsOf(deps.db, person.id)).map(storedCredential);
  const user = { id: userHandle(person.id), name: person.email, displayName: person.name };
  const options = await registrationOptions(deps.rp, user, existing);
  const challengeId = await storeChallenge(deps, 'add', person.id, options.challenge, now);
  return { options, challengeId };
}

/**
 * Registers the passkey, audited, only while the calling session is still live: one revoked during the ceremony
 * is `conflict` and adds nothing. From a `must_enrol` session (a recovery) the same batch also revokes the person's
 * every other passkey, session, identity and agent grant, and a full session is returned in place of the recovery
 * one; otherwise the session stays and null is returned.
 */
export async function completeAddPasskey(
  deps: AuthEnv,
  session: Session,
  challengeId: string | null,
  response: RegistrationResponseJSON,
  now: number,
): Promise<{ sessionId: string | null }> {
  const challenge = await takeChallenge(deps, challengeId, 'add', now);
  if (!challenge || challenge.personId !== session.personId) fail('passkey_failed');
  const credential = await verifyRegistration(deps.rp, response, challenge.challenge);
  if (!credential) fail('passkey_failed');
  const { db } = deps;
  const personId = session.personId;
  const sessionHash = await keyedHash(deps.secret, 'session', session.rawId);
  const transports = credential.transports ?? [];
  return retryOnce(async () => {
    const batch = await auditedBatch(ceremonyScope(personId), db);
    await batch.record(
      insertCredentialWhileLive(db, { ...credential, personId, transports }, sessionHash, now),
      {
        at: now,
        action: 'auth.addPasskey',
        clientId: null,
        target: `person:${personId}`,
        after: { credential: credential.id },
      },
      1,
    );
    if (!session.mustEnrol) {
      await batch.run();
      return { sessionId: null };
    }
    await recordRecoverySupersession(batch, db, personId, credential.id, now);
    const full = await newSession(db, deps.secret, personId, now);
    batch.also(full.statement);
    await batch.run();
    return { sessionId: full.rawId };
  });
}
