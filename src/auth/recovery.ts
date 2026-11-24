// Recovery: email plus one code opens a must_enrol session. Every failure answers the same after the same work.
import { auditedBatch, retryWhileOpen } from '../db/audit';
import { personByEmail } from '../db/people';
import { isUnusedCode, useCode } from '../db/recovery-codes';
import { ceremonyScope } from '../db/scope';
import type { AuthEnv } from '../lib/env';
import { fail } from '../lib/errors';
import { clearFailures, emailHash, isLocked, recordFailure } from './lockout';
import { codeHash, normalizeCode } from './recovery-codes';
import { newSession } from './session';

/** The id a lookup runs against when the email is unknown or offboarded, so that path costs the same. */
const NOBODY = '00000000-0000-0000-0000-000000000000';

/**
 * Consumes one code and opens a session that may only enrol a passkey. An unknown email, an offboarded
 * person, a wrong or used code and a locked email all count a failure (a locked one does not) and are
 * `recovery_failed`.
 */
export async function recover(
  deps: AuthEnv,
  email: string,
  code: string,
  now: number,
): Promise<{ sessionId: string; personId: string }> {
  const { db, secret } = deps;
  const hash = await emailHash(secret, email);
  const normalized = normalizeCode(code);
  const codeKey = await codeHash(secret, normalized ?? code);
  const person = await personByEmail(db, email.trim());
  const personId = person !== null && person.offboarded_at === null ? person.id : null;
  const locked = await isLocked(db, hash, now);
  const known = await isUnusedCode(db, personId ?? NOBODY, codeKey);
  if (locked) fail('recovery_failed');
  if (personId === null || normalized === null || !known) {
    await recordFailure(db, hash, now, personId !== null).catch(() => undefined);
    fail('recovery_failed');
  }
  const session = await newSession(db, secret, personId, now, true);
  await retryWhileOpen(
    async () => {
      const batch = await auditedBatch(ceremonyScope(personId), db);
      await batch.record(
        useCode(db, personId, codeKey, now),
        { at: now, action: 'auth.recover', clientId: null, target: `person:${personId}` },
        1,
      );
      batch.also(clearFailures(db, hash));
      batch.also(session.statement);
      await batch.run();
    },
    () => isUnusedCode(db, personId, codeKey),
    () => fail('recovery_failed'),
  );
  return { sessionId: session.rawId, personId };
}
