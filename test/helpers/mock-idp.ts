// An in-process identity provider for the SSO tests: it answers discovery, the token endpoint and the key set through
// the global `fetch` (which oauth4webapi calls), and a test plays the browser at its authorization endpoint with
// `authorize`. Each issuer signs with its own P-256 key generated per run. Synthetic only: no real provider, tenant or key.
import { vi } from 'vitest';

export interface MockIssuer {
  issuer: string;
  clientId: string;
  secret: string;
}

/** Who signs in, and what the ID token says about it; `claims` overrides any claim last, so a test can break one. */
export interface MockLogin {
  subject: string;
  email?: string;
  /** Seconds; default now. `null` leaves `auth_time` out. */
  authTime?: number | null;
  claims?: Record<string, unknown>;
  /** Replaces the `iss` or `state` of the redirect back, to test a mix-up or a forged callback. */
  redirect?: { iss?: string | null; state?: string };
}

interface Pending {
  issuer: MockIssuer;
  nonce: string;
  challenge: string;
  redirectUri: string;
  login: MockLogin;
}

export interface TokenRequest {
  issuer: string;
  authorization: string | null;
  params: URLSearchParams;
}

const encoder = new TextEncoder();
const b64u = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const json = (value: unknown): Response => Response.json(value);

async function sha256b64u(text: string): Promise<string> {
  return b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))));
}

async function sign(key: CryptoKeyPair, claims: object): Promise<string> {
  const head = b64u(encoder.encode(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: 'mock' })));
  const body = b64u(encoder.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key.privateKey,
    encoder.encode(`${head}.${body}`),
  );
  return `${head}.${body}.${b64u(new Uint8Array(sig))}`;
}

export interface MockIdp {
  /** The browser's side: follows the authorization address the app sent it to and returns the callback address. */
  authorize(location: string, login: MockLogin): string;
  readonly tokenRequests: TokenRequest[];
  /** The authorization requests seen, by their query. */
  readonly authorizations: URLSearchParams[];
  /** Answers every request for this issuer with a server error, to test an unreachable provider. */
  down(issuer: string): void;
  /** Serves a discovery document whose `issuer` is not the one asked for, as a multi-tenant endpoint does. */
  misnamed(issuer: string): void;
  restore(): void;
}

export async function mockIdp(issuers: readonly MockIssuer[]): Promise<MockIdp> {
  const keys = new Map<string, CryptoKeyPair>();
  for (const { issuer } of issuers)
    keys.set(
      issuer,
      await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
        'sign',
        'verify',
      ]),
    );
  const pending = new Map<string, Pending>();
  const tokenRequests: TokenRequest[] = [];
  const authorizations: URLSearchParams[] = [];
  const downed = new Set<string>();
  const misnamed = new Set<string>();
  const real = globalThis.fetch;
  const of = (url: string) => issuers.find((i) => url.startsWith(`${i.issuer}/`));

  async function token(issuer: MockIssuer, init: RequestInit | undefined): Promise<Response> {
    const body = init?.body;
    const params =
      body instanceof URLSearchParams
        ? body
        : new URLSearchParams(typeof body === 'string' ? body : '');
    const authorization = new Headers(init?.headers).get('authorization');
    tokenRequests.push({ issuer: issuer.issuer, authorization, params });
    // HTTP Basic with the id and secret each form-encoded first (RFC 6749 2.3.1).
    const [id = '', secret = ''] = atob((authorization ?? '').replace(/^Basic /, ''))
      .split(':')
      .map(decodeURIComponent);
    const grant = pending.get(params.get('code') ?? '');
    pending.delete(params.get('code') ?? '');
    const verified =
      grant?.issuer === issuer &&
      id === issuer.clientId &&
      secret === issuer.secret &&
      params.get('redirect_uri') === grant.redirectUri &&
      (await sha256b64u(params.get('code_verifier') ?? '')) === grant.challenge;
    if (!grant || !verified) return Response.json({ error: 'invalid_grant' }, { status: 400 });
    const now = Math.floor(Date.now() / 1000);
    const { login } = grant;
    const claims = {
      iss: issuer.issuer,
      sub: login.subject,
      aud: issuer.clientId,
      iat: now,
      exp: now + 300,
      nonce: grant.nonce,
      ...(login.authTime === null ? {} : { auth_time: login.authTime ?? now }),
      ...(login.email === undefined ? {} : { email: login.email }),
      ...login.claims,
    };
    const idToken = await sign(keys.get(issuer.issuer) as CryptoKeyPair, claims);
    return json({
      access_token: 'unused',
      token_type: 'Bearer',
      expires_in: 300,
      id_token: idToken,
    });
  }

  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const issuer = of(url);
    if (!issuer) return real(input, init);
    if (downed.has(issuer.issuer)) return new Response('down', { status: 503 });
    const path = url.slice(issuer.issuer.length);
    if (path === '/.well-known/openid-configuration')
      return json({
        issuer: misnamed.has(issuer.issuer)
          ? 'https://login.example/{tenantid}/v2.0'
          : issuer.issuer,
        authorization_endpoint: `${issuer.issuer}/authorize`,
        token_endpoint: `${issuer.issuer}/token`,
        jwks_uri: `${issuer.issuer}/keys`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['ES256'],
      });
    if (path === '/token') return token(issuer, init);
    if (path === '/keys')
      return json({
        keys: [
          await crypto.subtle.exportKey(
            'jwk',
            (keys.get(issuer.issuer) as CryptoKeyPair).publicKey,
          ),
        ],
      });
    return new Response('not found', { status: 404 });
  };
  vi.stubGlobal('fetch', handler);

  return {
    tokenRequests,
    authorizations,
    down: (issuer) => downed.add(issuer),
    misnamed: (issuer) => misnamed.add(issuer),
    restore: () => vi.unstubAllGlobals(),
    authorize(location, login) {
      const url = new URL(location);
      const issuer = issuers.find((i) => location.startsWith(`${i.issuer}/authorize?`));
      if (!issuer) throw new Error(`no mock issuer serves ${url.origin}${url.pathname}`);
      const q = url.searchParams;
      authorizations.push(q);
      if (q.get('client_id') !== issuer.clientId || q.get('response_type') !== 'code')
        throw new Error('the authorization request is malformed');
      const code = b64u(crypto.getRandomValues(new Uint8Array(16)));
      const redirectUri = q.get('redirect_uri') ?? '';
      pending.set(code, {
        issuer,
        nonce: q.get('nonce') ?? '',
        challenge: q.get('code_challenge') ?? '',
        redirectUri,
        login,
      });
      const back = new URL(redirectUri);
      back.searchParams.set('code', code);
      back.searchParams.set('state', login.redirect?.state ?? q.get('state') ?? '');
      const iss = login.redirect?.iss === undefined ? issuer.issuer : login.redirect.iss;
      if (iss !== null) back.searchParams.set('iss', iss);
      return back.href;
    },
  };
}
