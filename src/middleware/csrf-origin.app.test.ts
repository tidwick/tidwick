// Astro's own origin check is off (astro.config.mjs), so `csrf.ts` is the one gate. This file holds that it is
// enough: every other route refuses a form POST whose Origin is foreign, `null` or missing, with a session and
// without, and only `/oauth/token` (and `/mcp`) accept one with none.
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { caller, ORIGIN } from '../../test/helpers/callers';

const FORM = 'application/x-www-form-urlencoded';

async function post(
  path: string,
  origin: string | null,
  raw: string | null,
  body = 'a=b',
): Promise<Response> {
  const headers = new Headers({ 'content-type': FORM });
  if (origin !== null) headers.set('origin', origin);
  if (raw !== null) headers.set('cookie', `__Host-tidwick-session=${raw}`);
  return exports.default.fetch(new Request(`${ORIGIN}${path}`, { method: 'POST', headers, body }));
}

const ELSEWHERE = [
  '/account?_action=agents.revoke',
  '/oauth/authorize?_action=agents.grant',
  '/oauth/token?_action=agents.revoke',
  '/mcp?_action=agents.revoke',
  '/login?_action=auth.recover',
  '/week',
  '/approvals',
  '/_actions/agents.revoke',
  '/export/x.csv',
  '/oauth/authorize',
  '/no-such-page',
];

describe('SEC-65 a cross-origin browser POST is refused everywhere but the token endpoint', () => {
  it('SEC-65 refuses a foreign, null or missing Origin on every other route, signed in and out', async () => {
    const who = await caller();
    for (const path of ELSEWHERE) {
      for (const origin of ['https://evil.example', 'null', 'http://localhost:4322', null]) {
        for (const raw of [null, who.raw]) {
          const response = await post(path, origin, raw);
          expect(response.status, `${path} ${String(origin)} ${raw === null ? 'out' : 'in'}`).toBe(
            403,
          );
        }
      }
    }
  });

  it('SEC-65 lets the same form through the gate from ORIGIN (negative case: the check can pass)', async () => {
    const who = await caller();
    for (const path of ['/account?_action=agents.revoke', '/login?_action=auth.recover']) {
      expect((await post(path, ORIGIN, who.raw, `_csrf=${who.token}&id=x`)).status, path).not.toBe(
        403,
      );
    }
  });

  it('SEC-65 holds an Action post on an agent path to the token check, so a request with Origin but no _csrf is refused', async () => {
    const who = await caller();
    for (const path of ['/oauth/token?_action=agents.revoke', '/mcp?_action=agents.revoke']) {
      expect((await post(path, ORIGIN, who.raw)).status, path).toBe(403);
      expect((await post(path, ORIGIN, who.raw, `_csrf=${who.token}&id=x`)).status, path).not.toBe(
        403,
      );
    }
  });

  it('SEC-65 takes a form with no Origin only at /oauth/token, and still refuses a foreign one there', async () => {
    expect((await post('/oauth/token', null, null)).status).toBe(400);
    expect((await post('/oauth/token', ORIGIN, null)).status).toBe(400);
    expect((await post('/oauth/token', 'https://evil.example', null)).status).toBe(403);
    expect((await post('/oauth/token', 'null', null)).status).toBe(403);
  });
});
