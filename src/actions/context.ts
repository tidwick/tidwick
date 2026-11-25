// What every Action handler shares: the catalog boundary, the per-IP limit, cookies, and the caller's session.
import type { ActionAPIContext } from 'astro:actions';
import { CHALLENGE_COOKIE } from '../auth/challenge';
import { throttle } from '../auth/rate-limit';
import { cookieValue, type Session } from '../auth/session';
import { authEnv, currentEnv, type AuthEnv } from '../lib/env';
import type { Scope } from '../db/scope';
import { errorText } from '../lib/error-text';
import { fail, isAppError } from '../lib/errors';
import { forAction } from '../middleware/error-responses';

/**
 * Runs an Action body; a catalog error leaves as Astro's ActionError with the catalog status and message, and any
 * other error is logged for the operator as `errorText()` and leaves as the catalog's generic `internal` message.
 */
export async function act<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (!isAppError(error)) console.error('tidwick: Action failed:', errorText(error));
    throw forAction(error);
  }
}

/**
 * For the public auth Actions: counts the request against a per-IP limit, then returns what auth needs. The login
 * calls and the first-admin claim count against `LOGIN_LIMIT`, which is larger so an office behind one address
 * can sign in each morning; recovery and enrolment count against `RATE_LIMIT` (ADR 0003).
 */
export async function throttled(
  context: ActionAPIContext,
  bucket: 'login' | 'other' = 'other',
): Promise<AuthEnv> {
  const parsed = currentEnv();
  const ip = context.request.headers.get('cf-connecting-ip') ?? 'local';
  const limiter = bucket === 'login' ? parsed.LOGIN_LIMIT : parsed.RATE_LIMIT;
  await throttle(limiter, parsed.SESSION_SECRET, ip);
  return authEnv(parsed);
}

export function signedIn(context: ActionAPIContext): Session {
  return context.locals.session ?? fail('unauthenticated');
}

/** The caller's scope, which the authz middleware set from the route table row; absent only on a public row. */
export function scopeOf(context: ActionAPIContext): Scope {
  return context.locals.scope ?? fail('unauthenticated');
}

export function challengeId(context: ActionAPIContext): string | null {
  return cookieValue(context.request.headers.get('cookie'), CHALLENGE_COOKIE);
}

/** Queues a `Set-Cookie` value for the session middleware to append to this response. */
export function queueCookie(context: ActionAPIContext, cookie: string): void {
  context.locals.cookies.push(cookie);
}
