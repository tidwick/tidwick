import type { APIRoute } from 'astro';
import { startFlow } from '../../../auth/sso';
import { redirectTo, ssoRoute } from './_shared';

// Sends the browser to the provider to sign in. A link, never a form: `form-action 'self'` would cancel a POST that redirects off-site.
export const GET: APIRoute = (context) =>
  ssoRoute(context, async ({ env, now, provider, returnTo }) => {
    const { location, cookie } = await startFlow(
      env,
      { purpose: 'login', provider: provider(), returnTo: returnTo('/week') },
      now,
    );
    return redirectTo(location, cookie);
  });
