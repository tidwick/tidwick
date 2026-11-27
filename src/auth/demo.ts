// The demo's persona sign-in (ADR 0003): a picker for people shown the demo, never a login anywhere else. It answers
// only when all three signals hold, so a missing one is a route that does not exist.
import { auditStatement, readHead, retryOnce } from '../db/audit';
import { demoMarked } from '../db/demo';
import { ceremonyScope } from '../db/scope';
import { DEMO_PERSONAS, isPersonaId, type PersonaKey } from '../lib/demo-personas';
import type { Env } from '../lib/env';
import { fail } from '../lib/errors';
import { newSession } from './session';

/** The three signals: `DEMO_LOGIN` on, `DEMO_BANNER` on, and the seed's marker in the database. */
export async function demoOpen(env: Env): Promise<boolean> {
  return env.DEMO_LOGIN && env.DEMO_BANNER && (await demoMarked(env.DB));
}

/**
 * Opens a 2-hour session as `persona`, with the `auth.demoSignin` event in the same batch. A closed gate is
 * `not_found`, as for any route that is not there.
 */
export async function demoSignIn(env: Env, persona: PersonaKey, now: number): Promise<string> {
  if (!(await demoOpen(env))) fail('not_found');
  const who = DEMO_PERSONAS.find((p) => p.key === persona) ?? fail('not_found');
  return retryOnce(async () => {
    const session = await newSession(
      env.DB,
      env.SESSION_SECRET,
      who.id,
      now,
      env.POLICY.sessionMaxMs,
      false,
      true,
    );
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
