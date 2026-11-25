// The one-time first-admin claim on `/setup`: a deployer who set SETUP_TOKEN creates the first admin on an empty
// database from the browser. Every check is repeated here, since the Action is also reachable as an RPC call that
// never passes the page gate (SEC-48). Once any audit event or admin exists, nothing here writes.
import { bootstrapRefusal, claimInstance } from '../db/bootstrap';
import { instanceEmpty } from '../db/empty';
import { ceremonyScope } from '../db/scope';
import type { AuthEnv } from '../lib/env';
import { fail } from '../lib/errors';
import { newId } from '../lib/ids';
import { newClientKey } from '../lib/note-crypto';
import { keyedHash, randomToken, sameText } from './tokens';

export interface SetupDeps extends AuthEnv {
  readonly kek: string;
  /** SETUP_TOKEN as the env read it: null turns the claim off. */
  readonly setupToken: string | null;
}

/** Creates the first admin and returns where to enrol. Hashes both tokens first, so the compare never sees a length. */
export async function claimFirstAdmin(
  deps: SetupDeps,
  submitted: string,
  who: { readonly email: string; readonly name: string; readonly firm: string },
  now: number,
): Promise<{ next: string }> {
  if (deps.setupToken === null) fail('not_found');
  if (!(await instanceEmpty(deps.db))) fail('not_found');
  const [given, expected] = await Promise.all([
    keyedHash(deps.secret, 'setup', submitted),
    keyedHash(deps.secret, 'setup', deps.setupToken),
  ]);
  if (!sameText(given, expected)) fail('setup_failed');
  if (bootstrapRefusal(who.email, who.name, who.firm) !== null) fail('invalid_input');
  const clientId = newId();
  const token = randomToken();
  const claimed = await claimInstance(ceremonyScope(null), deps.db, {
    ...who,
    personId: newId(),
    firmId: newId(),
    clientId,
    key: await newClientKey(deps.kek, clientId, 1),
    enrolmentHash: await keyedHash(deps.secret, 'enrol', token),
    now,
  });
  if (!claimed) fail('not_found');
  return { next: `/enrol/${token}` };
}
