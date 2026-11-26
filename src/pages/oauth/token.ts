import type { APIRoute } from 'astro';
import { throttleAgent } from '../../auth/rate-limit';
import { currentEnv } from '../../lib/env';
import { errorText } from '../../lib/error-text';
import { isAppError } from '../../lib/errors';
import { OauthError } from '../../oauth/error';
import { exchange } from '../../oauth/exchange';

// The public token endpoint: a form from a client that is not a browser, so csrf.ts lets it pass with no Origin.
// Nothing is read from a cookie. Failures count against the caller's address, as bad bearers do on `/mcp`.
const FORM = /^application\/x-www-form-urlencoded(;|$)/i;
const NO_CACHE = { 'cache-control': 'no-store', pragma: 'no-cache' };

const refusal = (error: string, description: string, status = 400): Response =>
  Response.json({ error, error_description: description }, { status, headers: NO_CACHE });

export const POST: APIRoute = async ({ request }) => {
  const env = currentEnv();
  const ip = request.headers.get('cf-connecting-ip') ?? 'local';
  try {
    if (!FORM.test(request.headers.get('content-type') ?? ''))
      throw new OauthError(
        'invalid_request',
        'Send the request as application/x-www-form-urlencoded.',
      );
    const form = new URLSearchParams(await request.text());
    return Response.json(await exchange(env, form, Date.now()), { headers: NO_CACHE });
  } catch (error) {
    try {
      await throttleAgent(env.RATE_LIMIT, env.SESSION_SECRET, { ip });
    } catch {
      return refusal('invalid_request', 'Too many requests; wait a minute.', 429);
    }
    if (error instanceof OauthError) return refusal(error.error, error.message);
    if (isAppError(error) && error.status < 500) return refusal('invalid_request', error.message);
    console.error('tidwick: token request failed:', errorText(error));
    return refusal('server_error', 'The server could not answer.', 500);
  }
};

export const GET: APIRoute = () => new Response(null, { status: 405, headers: { allow: 'POST' } });
