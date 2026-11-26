// Login is one passkey assertion against a single-use challenge; it never names a person first.
import { activeCredential, useCredential } from '../db/credentials';
import { revokeSession } from '../db/sessions';
import type { AuthEnv } from '../lib/env';
import { fail } from '../lib/errors';
import { storeChallenge, takeChallenge } from './challenge';
import { storedCredential } from './passkeys';
import { newSession } from './session';
import { keyedHash } from './tokens';
import {
  authenticationOptions,
  verifyAuthentication,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from './webauthn';

export async function loginOptions(
  deps: AuthEnv,
  now: number,
): Promise<{ options: PublicKeyCredentialRequestOptionsJSON; challengeId: string }> {
  const options = await authenticationOptions(deps.rp);
  const challengeId = await storeChallenge(deps, 'login', null, options.challenge, now);
  return { options, challengeId };
}

/**
 * Verifies an assertion against the challenge behind `challengeId`, consuming it, and opens a new session.
 * A replayed, stale or foreign challenge, an unknown or revoked credential, or a bad signature is `login_failed`.
 */
export async function completeLogin(
  deps: AuthEnv,
  challengeId: string | null,
  response: AuthenticationResponseJSON,
  now: number,
): Promise<{ sessionId: string; personId: string }> {
  const challenge = await takeChallenge(deps, challengeId, 'login', now);
  if (!challenge) fail('login_failed');
  const row = await activeCredential(deps.db, response.id);
  if (!row) fail('login_failed');
  const verified = await verifyAuthentication(
    deps.rp,
    response,
    challenge.challenge,
    storedCredential(row),
  );
  if (!verified) fail('login_failed');
  const session = await newSession(
    deps.db,
    deps.secret,
    row.person_id,
    now,
    deps.policy.sessionMaxMs,
  );
  const counter = { from: row.counter, to: verified.newCounter };
  const [used] = await deps.db.batch([
    useCredential(deps.db, row.id, counter, now),
    session.statement,
  ]);
  if (used?.meta.changes !== 1) {
    await revokeSession(deps.db, await keyedHash(deps.secret, 'session', session.rawId), now).run();
    fail('login_failed');
  }
  return { sessionId: session.rawId, personId: row.person_id };
}
