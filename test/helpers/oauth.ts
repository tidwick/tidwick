// OAuth fixtures for the `app` project: a stubbed client document, a PKCE pair, and the three requests a client and a
// person make (the authorize page, the approve form, the token endpoint) through the built Worker.
import { exports } from 'cloudflare:workers';
import { vi } from 'vitest';
import { toBase64Url } from '../../src/auth/tokens';
import { ORIGIN, type Caller } from './callers';

export const CLIENT_ID = 'https://client.example/oauth/metadata.json';
export const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

export interface Document {
  client_id?: string;
  client_name?: string;
  redirect_uris?: unknown;
  token_endpoint_auth_method?: string;
}

/** Serves `documents` (address to body, or a ready Response) in place of the network, and records every fetch. */
export function stubDocuments(documents: Record<string, Document | string | Response>) {
  const fetched: { url: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    fetched.push({ url, init });
    const found = documents[url];
    if (found === undefined) return Promise.resolve(new Response('not found', { status: 404 }));
    if (found instanceof Response) return Promise.resolve(found);
    return Promise.resolve(Response.json(typeof found === 'string' ? JSON.parse(found) : found));
  });
  return { fetched, restore: () => vi.unstubAllGlobals() };
}

export const document = (over: Document = {}): Document => ({
  client_id: CLIENT_ID,
  client_name: 'Example Agent',
  redirect_uris: [CALLBACK],
  ...over,
});

export async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: toBase64Url(new Uint8Array(digest)) };
}

export type Query = Record<string, string | undefined>;

/** A complete, valid authorize query; `over` replaces a field, and `undefined` removes it. */
export function query(challenge: string, over: Query = {}): string {
  const base: Query = {
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: CALLBACK,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'xyz',
    resource: `${ORIGIN}/mcp`,
    scope: 'read write offline_access',
    ...over,
  };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(base)) if (value !== undefined) params.set(key, value);
  return params.toString();
}

function headers(who: Caller | null, extra: Record<string, string> = {}): Headers {
  const h = new Headers({ origin: ORIGIN, ...extra });
  if (who) h.set('cookie', `__Host-tidwick-session=${who.raw}`);
  return h;
}

export function authorize(who: Caller | null, search: string): Promise<Response> {
  return exports.default.fetch(
    new Request(`${ORIGIN}/oauth/authorize?${search}`, {
      headers: headers(who),
      redirect: 'manual',
    }),
  );
}

/** The approve form: POST to the authorize address plus `_action`, as the page's own form does. */
export function approve(
  who: Caller,
  search: string,
  scopes: readonly string[] = ['read', 'write'],
  origin: string | null = ORIGIN,
): Promise<Response> {
  const body = new URLSearchParams({ _csrf: who.token });
  for (const scope of scopes) body.append('scopes', scope);
  const h = headers(who, { 'content-type': 'application/x-www-form-urlencoded' });
  if (origin === null) h.delete('origin');
  else h.set('origin', origin);
  return exports.default.fetch(
    new Request(`${ORIGIN}/oauth/authorize?${search}&_action=agents.grant`, {
      method: 'POST',
      headers: h,
      body,
      redirect: 'manual',
    }),
  );
}

/** The address a hand-off page sends the person to. */
export async function handoff(response: Response): Promise<URL> {
  const html = await response.text();
  const link = /data-handoff-link[^>]*href="([^"]+)"|href="([^"]+)"[^>]*data-handoff-link/.exec(
    html,
  );
  const href = (link?.[1] ?? link?.[2] ?? '').replaceAll('&amp;', '&');
  return new URL(href);
}

export function token(fields: Record<string, string>, extra: Record<string, string> = {}) {
  const h = new Headers({ 'content-type': 'application/x-www-form-urlencoded', ...extra });
  return exports.default.fetch(
    new Request(`${ORIGIN}/oauth/token`, {
      method: 'POST',
      headers: h,
      body: new URLSearchParams(fields),
    }),
  );
}

/** The whole flow for one person: approve and exchange the code; returns the token response and the pieces. */
export async function connect(who: Caller, over: Query = {}, scopes?: readonly string[]) {
  const pair = await pkce();
  const search = query(pair.challenge, over);
  const approved = await approve(who, search, scopes);
  const back = await handoff(approved);
  const code = back.searchParams.get('code') ?? '';
  const redirect = over.redirect_uri ?? CALLBACK;
  const response = await token({
    grant_type: 'authorization_code',
    code,
    code_verifier: pair.verifier,
    redirect_uri: redirect,
    client_id: over.client_id ?? CLIENT_ID,
  });
  return {
    pair,
    search,
    approved,
    back,
    code,
    response,
    tokens: await response.json<Record<string, string>>(),
  };
}
