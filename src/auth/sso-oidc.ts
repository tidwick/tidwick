// The OpenID Connect half of single sign-on, over oauth4webapi: discovery, the authorization request, and the code
// exchange with its ID token checks. tidwick keeps no access or refresh token; it reads the ID token's claims and
// drops everything else. The token comes straight from the token endpoint over TLS, so its signature is not
// checked again (OpenID Connect Core 3.1.3.7). The flow row and the session are src/auth/sso.ts's.
import * as oauth from 'oauth4webapi';
import type { SsoProvider } from '../lib/sso-config';
import { fail, isAppError } from '../lib/errors';

export const SCOPE = 'openid email profile';
const CACHE_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 8000;
const SUBJECT_MAX = 255;

const discovered = new Map<string, { server: oauth.AuthorizationServer; at: number }>();

/** A request that fails in the network or runs out of time is the provider being down; anything else is a bad sign-in. */
function translated(error: unknown): never {
  const down =
    error instanceof TypeError ||
    (error instanceof DOMException &&
      (error.name === 'TimeoutError' || error.name === 'AbortError'));
  return fail(down ? 'sso_unavailable' : 'sso_failed');
}

const signal = (): AbortSignal => AbortSignal.timeout(TIMEOUT_MS);

/**
 * The provider's metadata, whose `issuer` must equal the configured one exactly, kept for an hour per isolate. A
 * provider that cannot be reached, or that answers with another issuer, is `sso_unavailable` for itself alone.
 */
export async function discover(
  provider: SsoProvider,
  now: number,
): Promise<oauth.AuthorizationServer> {
  const cached = discovered.get(provider.issuer);
  if (cached && now - cached.at < CACHE_MS) return cached.server;
  const server = await fetched(provider.issuer);
  if (!server?.authorization_endpoint || !server.token_endpoint) fail('sso_unavailable');
  discovered.set(provider.issuer, { server, at: now });
  return server;
}

async function fetched(issuer: string): Promise<oauth.AuthorizationServer | null> {
  try {
    const url = new URL(issuer);
    return await oauth.processDiscoveryResponse(
      url,
      await oauth.discoveryRequest(url, { algorithm: 'oidc', signal }),
    );
  } catch {
    return null;
  }
}

/** The address the browser is sent to; `fresh` asks the provider to authenticate again, not to reuse its own session. */
export async function authorizationUrl(
  provider: SsoProvider,
  server: oauth.AuthorizationServer,
  request: { redirectUri: string; state: string; nonce: string; verifier: string; fresh: boolean },
): Promise<string> {
  const url = new URL(server.authorization_endpoint ?? '');
  const query = url.searchParams;
  query.set('client_id', provider.clientId);
  query.set('redirect_uri', request.redirectUri);
  query.set('response_type', 'code');
  query.set('response_mode', 'query');
  query.set('scope', SCOPE);
  query.set('state', request.state);
  query.set('nonce', request.nonce);
  query.set('code_challenge', await oauth.calculatePKCECodeChallenge(request.verifier));
  query.set('code_challenge_method', 'S256');
  if (provider.hd !== null) query.set('hd', provider.hd);
  if (request.fresh) {
    query.set('max_age', '0');
    query.set('prompt', 'login');
  }
  return url.href;
}

export interface Claims {
  /** The provider's stable id for the person; with the issuer it is the identity. */
  readonly subject: string;
  /** For an admin to read; never an identity. */
  readonly email: string | null;
  /** When the person last authenticated at the provider, in seconds, or null when the token carries none. */
  readonly authTime: number | null;
}

/**
 * Checks the callback's `state`, `iss` and `error`, trades the code (with the PKCE verifier) for tokens, and checks
 * the ID token's issuer, audience, authorized party, times and nonce. `auth_time` is returned, not judged here.
 */
export async function exchange(
  provider: SsoProvider,
  server: oauth.AuthorizationServer,
  callback: URLSearchParams,
  expected: { redirectUri: string; state: string; nonce: string; verifier: string },
): Promise<Claims> {
  const client: oauth.Client = { client_id: provider.clientId };
  try {
    const params = oauth.validateAuthResponse(server, client, callback, expected.state);
    const response = await oauth.authorizationCodeGrantRequest(
      server,
      client,
      oauth.ClientSecretBasic(provider.clientSecret),
      params,
      expected.redirectUri,
      expected.verifier,
      { signal },
    );
    const tokens = await oauth.processAuthorizationCodeResponse(server, client, response, {
      expectedNonce: expected.nonce,
      requireIdToken: true,
      maxAge: oauth.skipAuthTimeCheck,
    });
    const claims = oauth.getValidatedIdTokenClaims(tokens);
    if (!claims || claims.sub.length === 0 || claims.sub.length > SUBJECT_MAX) fail('sso_failed');
    const hd = claims['hd'];
    if (provider.hd !== null && (typeof hd !== 'string' || hd.toLowerCase() !== provider.hd.toLowerCase()))
      fail('sso_failed');
    const { email, auth_time: authTime } = claims;
    return {
      subject: claims.sub,
      email: typeof email === 'string' && email.length <= 320 ? email : null,
      authTime: typeof authTime === 'number' ? authTime : null,
    };
  } catch (error) {
    if (isAppError(error)) throw error;
    return translated(error);
  }
}
