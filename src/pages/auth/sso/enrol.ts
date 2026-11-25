import type { APIRoute } from 'astro';
import { startFlow } from '../../../auth/sso';
import { fail } from '../../../lib/errors';
import { redirectTo, ssoRoute, tokenOf } from './_shared';

// The enrolment link's holder links a provider account instead of a passkey; the link is checked now and again at the callback.
// Only a page of this origin may start it: another site could otherwise send a visitor through a silent sign-in that binds
// their account to the sender's link.
export const GET: APIRoute = ({ request }) =>
  ssoRoute(request, async ({ env, now, url, provider }) => {
    const site = request.headers.get('sec-fetch-site');
    if (site !== null && site !== 'same-origin') fail('sso_failed');
    const { location, cookie } = await startFlow(
      env,
      { purpose: 'enrol', provider: provider(), returnTo: '/week', token: tokenOf(url) },
      now,
    );
    return redirectTo(location, cookie);
  });
