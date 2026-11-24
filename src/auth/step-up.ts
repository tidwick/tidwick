// Step-up: a passkey assertion in the last 15 minutes before high-impact work. Login and recovery count as one.
import { activeCredential, useCredential } from '../db/credentials';
import { stepUpSession } from '../db/sessions';
import type { AuthEnv } from '../lib/env';
import { fail } from '../lib/errors';
import { storeChallenge, takeChallenge } from './challenge';
import { storedCredential } from './passkeys';
import type { Session } from './session';
import { keyedHash } from './tokens';
import {
  authenticationOptions,
  verifyAuthentication,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from './webauthn';

export const STEP_UP_MS = 15 * 60 * 1000;

/** The one gate for every step-up row: refuses a session whose last assertion is 15 minutes old or more. */
export function requireStepUp(session: Session, now: number): void {
  if (now - session.stepUpAt >= STEP_UP_MS) fail('step_up_required');
}

export async function stepUpOptions(
  deps: AuthEnv,
  session: Session,
  now: number,
): Promise<{ options: PublicKeyCredentialRequestOptionsJSON; challengeId: string }> {
  const options = await authenticationOptions(deps.rp);
  const challengeId = await storeChallenge(
    deps,
    'step_up',
    session.personId,
    options.challenge,
    now,
  );
  return { options, challengeId };
}

/**
 * Verifies an assertion by one of the session's own passkeys against its single-use challenge and stamps the
 * session. A challenge issued to another person, another person's passkey or a bad signature is `passkey_failed`.
 */
export async function completeStepUp(
  deps: AuthEnv,
  session: Session,
  challengeId: string | null,
  response: AuthenticationResponseJSON,
  now: number,
): Promise<void> {
  const challenge = await takeChallenge(deps, challengeId, 'step_up', now);
  if (challenge?.personId !== session.personId) fail('passkey_failed');
  const row = await activeCredential(deps.db, response.id);
  if (row?.person_id !== session.personId) fail('passkey_failed');
  const verified = await verifyAuthentication(
    deps.rp,
    response,
    challenge.challenge,
    storedCredential(row),
  );
  if (!verified) fail('passkey_failed');
  const counter = { from: row.counter, to: verified.newCounter };
  const used = await useCredential(deps.db, row.id, counter, now).run();
  if (used.meta.changes !== 1) fail('passkey_failed');
  const idHash = await keyedHash(deps.secret, 'session', session.rawId);
  const stamped = await stepUpSession(deps.db, idHash, now).run();
  if (stamped.meta.changes !== 1) fail('passkey_failed');
}
