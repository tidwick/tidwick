import type { APIRoute } from 'astro';
import { startFlow } from '../../../auth/sso';
import { fail } from '../../../lib/errors';
import { redirectTo, ssoRoute } from './_shared';

// A signed-in person confirms again at the provider (`max_age=0`, `prompt=login`) instead of with a passkey.
export const GET: APIRoute = (context) =>
  ssoRoute(context, async ({ env, now, provider, returnTo }) => {
    const session = context.locals.session ?? fail('unauthenticated');
    const { location, cookie } = await startFlow(
      env,
      { purpose: 'step_up', provider: provider(), returnTo: returnTo('/account'), session },
      now,
    );
    return redirectTo(location, cookie);
  });
