// An authorization request, read and vetted in full before anything is shown or issued. It is read again when the
// person approves, from the same address, so the approve step trusts nothing the page said.
import type { Env } from '../lib/env';
import { fetchClient, type Client } from './cimd';
import { OauthError } from './error';
import { isListed, requireTrusted } from './redirect';

/** The scopes a client may ask for. `offline_access` asks for a refresh token, which every grant here gets. */
export const SCOPES_SUPPORTED = ['read', 'write', 'submit', 'offline_access'] as const;
export const TOOL_SCOPES = ['read', 'write', 'submit'] as const;
export type ToolScope = (typeof TOOL_SCOPES)[number];

const STATE_MAX = 512;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export interface AuthRequest {
  client: Client;
  /** The redirect address the client sent, stored on the grant and held to at the token request. */
  redirectUri: string;
  state: string | null;
  challenge: string;
  /** The scopes the person is offered; none asked for means all three. */
  offered: readonly ToolScope[];
}

/** The resource every token here is for; a request naming any other is refused. */
export const audience = (origin: string): string => `${origin}/mcp`;

/** A parameter's one value, null when absent; a repeated one is refused, as RFC 6749 3.1 says. */
export function one(params: URLSearchParams, name: string): string | null {
  const all = params.getAll(name);
  if (all.length > 1) throw new OauthError('invalid_request', `The parameter ${name} is repeated.`);
  return all[0] ?? null;
}

function need(params: URLSearchParams, name: string): string {
  const value = one(params, name);
  if (value === null || value === '')
    throw new OauthError('invalid_request', `The parameter ${name} is missing.`);
  return value;
}

/** The tool scopes a `scope` value asks for; an unknown word is `invalid_scope`. */
export function scopesAsked(value: string | null): ToolScope[] {
  const words = (value ?? '').split(/\s+/).filter((w) => w !== '');
  for (const word of words) {
    if (!(SCOPES_SUPPORTED as readonly string[]).includes(word))
      throw new OauthError('invalid_scope', 'A scope that was asked for is not offered.');
  }
  return TOOL_SCOPES.filter((s) => words.includes(s));
}

/** Reads the authorize query: PKCE S256 only, the resource this server's `/mcp`, a client its policy accepts. */
export async function readAuthorize(params: URLSearchParams, env: Env): Promise<AuthRequest> {
  if (need(params, 'response_type') !== 'code')
    throw new OauthError('invalid_request', 'Only response_type=code is supported.');
  const challenge = need(params, 'code_challenge');
  if (need(params, 'code_challenge_method') !== 'S256' || !CHALLENGE.test(challenge))
    throw new OauthError('invalid_request', 'PKCE with S256 is required.');
  const resource = one(params, 'resource');
  if (resource !== null && resource !== audience(env.ORIGIN))
    throw new OauthError('invalid_target', 'The resource is not this server’s /mcp.');
  const state = one(params, 'state');
  if (state !== null && state.length > STATE_MAX)
    throw new OauthError('invalid_request', 'The state is too long.');
  const asked = scopesAsked(one(params, 'scope'));
  const redirectUri = need(params, 'redirect_uri');
  const client = await fetchClient(need(params, 'client_id'), env.ORIGIN);
  requireTrusted(client.redirectUris, env.MCP_CLIENTS);
  if (!isListed(redirectUri, client.redirectUris))
    throw new OauthError('invalid_request', 'The redirect address is not one the client lists.');
  return {
    client,
    redirectUri,
    state,
    challenge,
    offered: asked.length === 0 ? TOOL_SCOPES : asked,
  };
}

/** Where the person goes back to: the client's redirect with the code (or an error), the state and this issuer. */
export function returnAddress(
  request: Pick<AuthRequest, 'redirectUri' | 'state'>,
  origin: string,
  result: { code: string } | { error: string },
): string {
  const url = new URL(request.redirectUri);
  for (const [key, value] of Object.entries(result)) url.searchParams.set(key, value);
  if (request.state !== null) url.searchParams.set('state', request.state);
  url.searchParams.set('iss', origin);
  return url.href;
}
