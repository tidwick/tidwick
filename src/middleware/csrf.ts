// Runs second: every POST must come from ORIGIN, and with a session must carry that session's `_csrf` token in a
// body of at most MAX_POST_BYTES, counted as it is read, so no route or Action after it buffers more. A script call
// is refused with the catalog body, a page form with a page linking back to reload it. The two agent paths are
// the exception unless the request is an Action post: their callers are not browsers (see `agentVerdict`).
import type { MiddlewareHandler } from 'astro';
import { cookieValue, SESSION_COOKIE, type Session } from '../auth/session';
import { csrfToken, sameText } from '../auth/tokens';
import { currentEnv } from '../lib/env';
import { errorPage, errorResponse } from './error-responses';
import { rpcRefusal } from './mcp-responses';
import { MAX_POST_BYTES } from '../lib/limits';
import { RPC_PATTERN } from './authz';

export type CsrfVerdict =
  'ok' | 'foreign_origin' | 'too_large' | 'missing_token' | 'wrong_token' | 'cookie_and_bearer';

/** The paths whose callers are not browsers: the MCP route, which takes a bearer, and the token endpoint, which takes a form. */
const AGENT_PATHS: ReadonlySet<string> = new Set(['/mcp', '/oauth/token']);

/** The route patterns that exist only while `MCP` is on; off, each is a 404 before a session or a table row is read. */
const MCP_ONLY: ReadonlySet<string> = new Set([
  ...AGENT_PATHS,
  '/oauth/authorize',
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp',
  '/.well-known/oauth-authorization-server',
]);

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const FORM = /^(application\/x-www-form-urlencoded|multipart\/form-data)/i;
const JSON_BODY = /^application\/json/i;

/** A clone of the body as bytes, or null once it passes `MAX_POST_BYTES`, whatever `content-length` claims. */
async function boundedBody(request: Request): Promise<Uint8Array<ArrayBuffer> | null> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_POST_BYTES) return null;
  const reader = request.clone().body?.getReader();
  if (reader === undefined) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    total += read.value.byteLength;
    if (total > MAX_POST_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(read.value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

/** The `_csrf` field of a form or JSON body, parsed from bytes already read within the cap. */
async function submittedToken(
  type: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string | null> {
  const body = new Response(bytes, { headers: { 'content-type': type } });
  try {
    if (FORM.test(type)) {
      const value = (await body.formData()).get('_csrf');
      return typeof value === 'string' ? value : null;
    }
    if (JSON_BODY.test(type)) {
      const parsed: unknown = await body.json();
      if (typeof parsed !== 'object' || parsed === null || !('_csrf' in parsed)) return null;
      return typeof parsed._csrf === 'string' ? parsed._csrf : null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * An agent path's POST: a client that is not a browser sends no `Origin`, so an absent one passes and a present one
 * must still equal `origin`. A request carrying a session cookie and a bearer both is refused, so a browser can never
 * make the two meet. The body is still read within `MAX_POST_BYTES`, though no session means no token to find.
 */
async function agentVerdict(request: Request, origin: string): Promise<CsrfVerdict> {
  const sent = request.headers.get('origin');
  if (sent !== null && sent !== origin) return 'foreign_origin';
  const cookie = cookieValue(request.headers.get('cookie'), SESSION_COOKIE);
  if (cookie !== null && request.headers.has('authorization')) return 'cookie_and_bearer';
  return (await boundedBody(request)) === null ? 'too_large' : 'ok';
}

/**
 * Judges one request for both Action callers, `/_actions/<name>` and `?_action=<name>`: a safe method passes,
 * any other needs `Origin` equal to `origin` (a missing one is refused), and with a session a body within the cap
 * that carries the derived token.
 */
export async function csrfVerdict(
  request: Request,
  origin: string,
  secret: string,
  session: Session | null,
): Promise<CsrfVerdict> {
  if (SAFE.has(request.method)) return 'ok';
  const url = new URL(request.url);
  // An Action post (`?_action=`) is a browser form, whatever its path: it takes the Origin and token check below.
  if (AGENT_PATHS.has(url.pathname) && !url.searchParams.has('_action'))
    return agentVerdict(request, origin);
  if (request.headers.get('origin') !== origin) return 'foreign_origin';
  if (!session) return 'ok';
  const bytes = await boundedBody(request);
  if (bytes === null) return 'too_large';
  const token = await submittedToken(request.headers.get('content-type') ?? '', bytes);
  if (token === null) return 'missing_token';
  return sameText(token, await csrfToken(secret, session.rawId)) ? 'ok' : 'wrong_token';
}

/**
 * The page the refused form was on: the same-origin `Referer` (Referrer-Policy same-origin sends it), else the
 * posted path, as a path on this origin so the link can only lead back into tidwick. Its `saved` flag is dropped,
 * since the refused post saved nothing.
 */
export function formPage(request: Request, origin: string): string {
  const posted = new URL(request.url);
  let page = posted;
  try {
    const referer = new URL(request.headers.get('referer') ?? '');
    if (referer.origin === origin) page = referer;
  } catch {
    page = posted;
  }
  const params = new URLSearchParams(page === posted ? '' : page.search);
  params.delete('saved');
  const rest = params.toString();
  const query = rest === '' ? '' : `?${rest}`;
  return `/${page.pathname.replace(/^\/+/, '')}${query}`;
}

export const csrf: MiddlewareHandler = async (context, next) => {
  const { MCP, ORIGIN, SESSION_SECRET } = currentEnv();
  const agent = AGENT_PATHS.has(context.url.pathname);
  if (!MCP && MCP_ONLY.has(context.routePattern))
    return agent ? rpcRefusal('not_found') : errorPage(context, 'not_found');
  const verdict = await csrfVerdict(
    context.request,
    ORIGIN,
    SESSION_SECRET,
    context.locals.session,
  );
  if (verdict === 'ok') return next();
  const code = verdict === 'too_large' ? 'invalid_input' : 'csrf';
  if (agent) return rpcRefusal(code);
  if (context.routePattern === RPC_PATTERN) return errorResponse(code);
  return errorPage(context, code, undefined, {
    href: formPage(context.request, ORIGIN),
    label: 'Reload the page',
  });
};
