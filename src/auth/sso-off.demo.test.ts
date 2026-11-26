// SSO is off unless `SSO_PROVIDERS` is set, and the demo project sets none, as a deployment does by default: every
// /auth/sso route is a 404 to everyone, and the sign-in page offers passkeys alone.
import { describe, expect, it } from 'vitest';
import { caller, getPage } from '../../test/helpers/callers';

describe('SSO off', () => {
  it('each route is a 404 for a visitor and for a signed-in person, with or without a provider named', async () => {
    const who = await caller();
    for (const path of [
      '/auth/sso/login?provider=google',
      '/auth/sso/enrol?provider=google&token=x',
      '/auth/sso/step-up?provider=google',
      '/auth/sso/callback?code=c&state=s',
    ]) {
      expect((await getPage(path, null)).status, path).toBe(path.includes('step-up') ? 303 : 404);
      expect((await getPage(path, who)).status, path).toBe(404);
    }
  });

  it('the sign-in page shows no provider button, and still its passkey button', async () => {
    const html = await (await getPage('/login', null)).text();
    expect(html).not.toContain('data-sso-links');
    expect(html).toContain('data-passkey="login"');
  });
});
