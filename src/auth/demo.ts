// The demo's shared-password sign-in (ADR 0003): a persona picker for people shown the demo, never a login anywhere
// else. It answers only when all four signals hold, so a missing one is a route that does not exist.
import { auditStatement, readHead, retryOnce } from '../db/audit';
import { demoMarked } from '../db/demo';
import { ceremonyScope } from '../db/scope';
import { DEMO_PERSONAS, isPersonaId, type PersonaKey } from '../lib/demo-personas';
import type { Env } from '../lib/env';
import { fail } from '../lib/errors';
import { newSession } from './session';

/** The four signals: `DEMO_LOGIN` on, a password of 16 or more characters, `DEMO_BANNER` on, and the seed's marker. */
export async function demoOpen(env: Env): Promise<boolean> {
  return (
    env.DEMO_LOGIN && env.DEMO_BANNER && env.DEMO_PASSWORD !== null && (await demoMarked(env.DB))
  );
}

/** The password to print on the sign-in page: only when the whole gate holds, read from the env at request time. */
export async function demoPasswordShown(env: Env): Promise<string | null> {
  return (await demoOpen(env)) ? env.DEMO_PASSWORD : null;
}

const digest = async (text: string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

/** Compares the SHA-256 digests in constant time, so neither the password's length nor its prefix shows. */
export async function passwordMatches(given: string, expected: string): Promise<boolean> {
  // `timingSafeEqual` is a Workers extension the bundled types lack.
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
  };
  return subtle.timingSafeEqual(await digest(given), await digest(expected));
}

/**
 * Opens a 2-hour session as `persona`, with the `auth.demoSignin` event in the same batch, or returns null for a wrong
 * password. A closed gate is `not_found`, as for any route that is not there.
 */
export async function demoSignIn(
  env: Env,
  password: string,
  persona: PersonaKey,
  now: number,
): Promise<string | null> {
  if (!(await demoOpen(env)) || env.DEMO_PASSWORD === null) fail('not_found');
  if (!(await passwordMatches(password, env.DEMO_PASSWORD))) return null;
  const who = DEMO_PERSONAS.find((p) => p.key === persona) ?? fail('not_found');
  return retryOnce(async () => {
    const session = await newSession(env.DB, env.SESSION_SECRET, who.id, now, false, true);
    const event = await auditStatement(
      ceremonyScope(who.id),
      env.DB,
      await readHead(env.DB),
      {
        at: now,
        action: 'auth.demoSignin',
        clientId: null,
        target: `person:${who.id}`,
        after: { persona },
      },
      null,
    );
    await env.DB.batch([session.statement, event.statement]);
    return session.rawId;
  });
}

/** In the demo the four persona accounts are shared, so no visitor may lock them out or attach a passkey to one. */
export async function guardPersona(env: Env, personId: string): Promise<void> {
  if (isPersonaId(personId) && (await demoOpen(env))) fail('forbidden', 'a demo persona');
}
