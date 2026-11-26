// MCP is off unless `MCP` is `on`, and the demo project leaves it unset, as a deployment does by default: every agent
// route is then a 404 to everyone, a valid-looking token included, before anything reads a bearer.
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call2025, mcp, mintAgent } from '../../test/helpers/agent';
import { addPerson } from '../../test/helpers/auth';
import { caller, formPost, getPage, ORIGIN, rpcForm } from '../../test/helpers/callers';

describe('MCP off', () => {
  it('/mcp is a 404 for a GET, a POST, a POST with a live token and a POST with a foreign Origin', async () => {
    const person = await addPerson();
    const live = await mintAgent(person.id);
    for (const [token, options] of [
      [null, { method: 'GET' }],
      [null, {}],
      [live.token, {}],
      [live.token, { origin: 'https://evil.example' }],
      [live.token, { origin: null }],
    ] as const) {
      const response = await mcp(token, call2025('list_projects'), options);
      expect(response.status, JSON.stringify(options)).toBe(404);
      expect(response.headers.get('www-authenticate')).toBeNull();
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(response.body, JSON.stringify(options)).toMatchObject({
        jsonrpc: '2.0',
        error: { message: 'Not found' },
      });
    }
  });

  it('the token endpoint path is refused too, and the rest of the site still answers', async () => {
    const token = await exports.default.fetch(
      new Request(`${ORIGIN}/oauth/token`, { method: 'POST', body: 'grant_type=refresh_token' }),
    );
    expect([403, 404]).toContain(token.status);
    expect((await exports.default.fetch(new Request(`${ORIGIN}/healthz`))).status).not.toBe(404);
  });

  it('the token Actions are a 404 and the account page has no agent section, whatever the caller holds', async () => {
    const who = await caller();
    const fields = { label: 'Laptop', days: '30', scopes: ['read'] };
    expect((await rpcForm('agents.mint', who, fields)).status).toBe(404);
    expect((await formPost('/account', 'agents.mint', who, fields)).status).toBe(404);
    expect((await rpcForm('agents.revoke', who, { id: 'x' })).status).toBe(404);
    const page = await getPage('/account', who);
    expect(page.status).toBe(200);
    expect(await page.text()).not.toContain('data-agents');
  });
});
