// Runs first: attaches the live session and its CSRF token, then appends the cookies an Action queued.
import type { MiddlewareHandler } from 'astro';
import { cookieValue, readSession, SESSION_COOKIE } from '../auth/session';
import { csrfToken } from '../auth/tokens';
import { currentEnv } from '../lib/env';

export const session: MiddlewareHandler = async (context, next) => {
  const { DB, SESSION_SECRET, POLICY } = currentEnv();
  const raw = cookieValue(context.request.headers.get('cookie'), SESSION_COOKIE);
  const live =
    raw === null
      ? null
      : await readSession(DB, SESSION_SECRET, raw, Date.now(), POLICY.sessionIdleMs);
  context.locals.session = live;
  context.locals.csrf = live ? await csrfToken(SESSION_SECRET, live.rawId) : '';
  context.locals.cookies = [];
  const response = await next();
  if (context.locals.cookies.length === 0) return response;
  const out = new Response(response.body, response);
  for (const cookie of context.locals.cookies) out.headers.append('set-cookie', cookie);
  return out;
};
