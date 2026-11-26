// MCP is off in the demo project, as on a deployment by default: every OAuth route is a 404 to everyone, signed in or
// not, and a signed-out visitor is never sent to sign in by a route that does not exist.
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { caller, ORIGIN } from '../../test/helpers/callers';

const PATHS = [
  '/oauth/authorize?response_type=code',
  '/oauth/authorize/',
  '/oauth/token',
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp',
  '/.well-known/oauth-authorization-server',
];

describe('MCP off: the OAuth routes', () => {
  it('answer 404 to a GET and a POST, signed out and signed in', async () => {
    const who = await caller();
    for (const path of PATHS) {
      for (const method of ['GET', 'POST']) {
        for (const cookie of [undefined, `__Host-tidwick-session=${who.raw}`]) {
          const headers = new Headers(cookie === undefined ? {} : { cookie });
          if (method === 'POST') headers.set('content-type', 'application/x-www-form-urlencoded');
          const init = {
            method,
            headers,
            redirect: 'manual',
            ...(method === 'POST' ? { body: 'a=b' } : {}),
          } as const;
          const response = await exports.default.fetch(new Request(`${ORIGIN}${path}`, init));
          expect(response.status, `${method} ${path}`).toBe(404);
          expect(response.headers.get('location')).toBeNull();
        }
      }
    }
  });
});
