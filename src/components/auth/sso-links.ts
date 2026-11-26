// The links that start a single sign-on flow, one per provider the operator allows. They are plain links, never
// forms: `form-action 'self'` would cancel a POST that redirects off-site. None when SSO is off.
import { liveIdentitiesOf } from '../../db/identities';
import { currentEnv } from '../../lib/env';

export interface SsoLink {
  href: string;
  text: string;
}

const link = (path: string, params: Record<string, string>, text: string): SsoLink => ({
  href: `${path}?${new URLSearchParams(params).toString()}`,
  text,
});

export const signInLinks = (returnTo = '/week'): SsoLink[] =>
  currentEnv().SSO.map((p) =>
    link('/auth/sso/login', { provider: p.id, return: returnTo }, `Sign in with ${p.label}`),
  );

export const enrolLinks = (token: string): SsoLink[] =>
  currentEnv().SSO.map((p) =>
    link('/auth/sso/enrol', { provider: p.id, token }, `Continue with ${p.label}`),
  );

/** A way to confirm again for each provider the person has an identity at, coming back to `returnTo`. */
export async function confirmLinks(personId: string, returnTo: string): Promise<SsoLink[]> {
  const { DB, SSO } = currentEnv();
  const held = new Set((await liveIdentitiesOf(DB, personId)).map((i) => i.issuer));
  return SSO.filter((p) => held.has(p.issuer)).map((p) =>
    link('/auth/sso/step-up', { provider: p.id, return: returnTo }, `Confirm with ${p.label}`),
  );
}
