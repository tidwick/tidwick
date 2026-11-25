import type { APIRoute } from 'astro';
import { startFlow } from '../../../auth/sso';
import { redirectTo, ssoRoute, tokenOf } from './_shared';

// The enrolment link's holder links a provider account instead of a passkey; the link is checked now and again at the callback.
export const GET: APIRoute = ({ request }) =>
  ssoRoute(request, async ({ env, now, url, provider }) => {
    const { location, cookie } = await startFlow(
      env,
      { purpose: 'enrol', provider: provider(), returnTo: '/week', token: tokenOf(url) },
      now,
    );
    return redirectTo(location, cookie);
  });
