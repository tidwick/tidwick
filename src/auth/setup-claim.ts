// The one-time first-admin claim on `/setup`: a deployer who set SETUP_TOKEN creates the first admin on an empty
// database from the browser. Every check is repeated here, since the Action is also reachable as an RPC call that
// never passes the page gate (SEC-48). Once any audit event or admin exists, nothing here creates an admin. The one
// other write is a re-issued enrolment link (`people.rescue`, audited) for the sole admin while that admin has no
// passkey and no linked identity, so a lost first link needs no CLI; once a credential exists it writes nothing.
import { bootstrapRefusal, claimInstance } from '../db/bootstrap';
import { instanceEmpty } from '../db/empty';
import { lockedOutAdmin, reissueLink } from '../db/rescue';
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

/** True when the Worker's origin host is the relying party id or a subdomain of it, as WebAuthn needs to enrol. */
export function rpIdFits(origin: string, rpId: string): boolean {
  const { hostname } = new URL(origin);
  return hostname === rpId || hostname.endsWith(`.${rpId}`);
}

/** Whether the setup page may offer the claim: an empty database, or a sole admin who still cannot sign in. */
export async function claimOpen(db: D1Database): Promise<boolean> {
  return (await instanceEmpty(db)) || (await lockedOutAdmin(db)) !== null;
}

/** Creates the first admin and returns where to enrol. Hashes both tokens first, so the compare never sees a length. */
export async function claimFirstAdmin(
  deps: SetupDeps,
  submitted: string,
  who: { readonly email: string; readonly name: string; readonly firm: string },
  now: number,
): Promise<{ next: string }> {
  if (deps.setupToken === null) fail('not_found');
  const empty = await instanceEmpty(deps.db);
  const locked = empty ? null : await lockedOutAdmin(deps.db);
  if (!empty && locked === null) fail('not_found');
  if (!rpIdFits(deps.rp.origin, deps.rp.id)) fail('setup_rp_id');
  const [given, expected] = await Promise.all([
    keyedHash(deps.secret, 'setup', submitted),
    keyedHash(deps.secret, 'setup', deps.setupToken),
  ]);
  if (!sameText(given, expected)) fail('setup_failed');
  if (locked !== null) return reissue(deps, locked, who.email, now);
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

/** Gives the locked-out sole admin a new link, onto the audit head just read; a moved head or a new passkey takes no row. */
async function reissue(
  deps: SetupDeps,
  admin: { id: string; email: string },
  email: string,
  now: number,
): Promise<{ next: string }> {
  if (email !== admin.email.toLowerCase()) fail('not_found');
  const token = randomToken();
  const written = await reissueLink(
    deps.db,
    admin.id,
    await keyedHash(deps.secret, 'enrol', token),
    now,
  );
  if (!written) fail('not_found');
  return { next: `/enrol/${token}` };
}
