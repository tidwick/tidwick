import type { APIRoute } from 'astro';
import { cookieValue, sessionCookie } from '../../../auth/session';
import { clearedSsoCookie, finishFlow, SSO_COOKIE } from '../../../auth/sso';
import { handoffPage } from '../../../middleware/handoff';
import { ssoRoute } from './_shared';

// Public: the provider's redirect carries no session cookie. A GET meets neither the Origin rule nor `checkOrigin`,
// so nothing is carved out; the flow cookie must equal `state`, which is what a forged callback lacks.
export const GET: APIRoute = (context) =>
  ssoRoute(context, async ({ env, now, url }) => {
    const cookie = cookieValue(context.request.headers.get('cookie'), SSO_COOKIE);
    const done = await finishFlow(env, cookie, url, now);
    const session = done.sessionId === null ? [] : [sessionCookie(done.sessionId)];
    return handoffPage(done.returnTo, [clearedSsoCookie(), ...session]);
  });
