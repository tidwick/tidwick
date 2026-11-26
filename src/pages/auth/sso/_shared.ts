// What the four SSO routes share: the 404 when SSO is off, the per-IP limit in the login bucket, and the catalog's
// page with a way back. Astro does not route files that start with an underscore.
import type { APIContext } from 'astro';
import { throttle } from '../../../auth/rate-limit';
import { clearedSsoCookie, providerOf, safeReturn } from '../../../auth/sso';
import { currentEnv, type Env } from '../../../lib/env';
import { fail, isAppError } from '../../../lib/errors';
import { errorPage } from '../../../middleware/error-responses';
import type { SsoProvider } from '../../../lib/sso-config';

export interface SsoRequest {
  env: Env;
  now: number;
  url: URL;
  provider: () => SsoProvider;
  /** The `return` query, only when it is a same-origin path. */
  returnTo: (fallback: string) => string;
}

/**
 * Runs one SSO route: SSO off is a 404, every call counts against the login bucket, and a catalog error leaves as
 * its page with a link back to the sign-in page and the flow cookie cleared, whatever the outcome.
 */
export async function ssoRoute(
  context: APIContext,
  body: (call: SsoRequest) => Promise<Response>,
): Promise<Response> {
  const env = currentEnv();
  if (env.SSO.length === 0) return errorPage(context, 'not_found');
  const { request, url } = context;
  try {
    await throttle(
      env.LOGIN_LIMIT,
      env.SESSION_SECRET,
      request.headers.get('cf-connecting-ip') ?? 'local',
    );
    return await body({
      env,
      now: Date.now(),
      url,
      provider: () => providerOf(env, url.searchParams.get('provider')),
      returnTo: (fallback) => safeReturn(url.searchParams.get('return'), fallback),
    });
  } catch (error) {
    if (!isAppError(error)) throw error;
    const refused = await errorPage(context, error.code, undefined, {
      href: '/login',
      label: 'Back to sign in',
    });
    const page = new Response(refused.body, refused);
    page.headers.append('set-cookie', clearedSsoCookie());
    return page;
  }
}

export const redirectTo = (location: string, cookie: string): Response =>
  new Response(null, { status: 302, headers: { location, 'set-cookie': cookie } });

/** The enrolment link a start route was given: required, and bounded like the Action's. */
export function tokenOf(url: URL): string {
  const token = url.searchParams.get('token') ?? '';
  if (token === '' || token.length > 128) fail('enrolment_invalid');
  return token;
}
