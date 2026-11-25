// A refusal outside a tool call is JSON-RPC-shaped JSON through the built Worker, never a page.
import { describe, expect, it } from 'vitest';
import { mcp, mintAgent, rpc2025 } from '../../test/helpers/agent';
import { booking } from '../../test/helpers/booking';

async function agent() {
  return mintAgent((await booking()).who.personId);
}

/** Every failure outside a tool is JSON-RPC-shaped JSON, never a page. */
function expectRpcError(
  response: { headers: Headers; body: Record<string, unknown> },
  label: string,
) {
  expect(response.headers.get('content-type'), label).toContain('application/json');
  expect(response.body, label).toMatchObject({
    jsonrpc: '2.0',
    id: null,
    error: { code: expect.any(Number) as number, message: expect.any(String) as string },
  });
}

describe('a refusal before any tool runs is JSON-RPC, not HTML', () => {
  it('a missing or bad token, a foreign Origin, a cookie with a bearer, a bad body and a bad method', async () => {
    const who = await agent();
    const cases = [
      ['no token', await mcp(null, rpc2025('ping')), 401],
      ['bad token', await mcp('x', rpc2025('ping')), 401],
      [
        'foreign origin',
        await mcp(who.token, rpc2025('ping'), { origin: 'https://evil.example' }),
        403,
      ],
      [
        'cookie and bearer',
        await mcp(who.token, rpc2025('ping'), { headers: { cookie: '__Host-tidwick-session=x' } }),
        403,
      ],
      ['bad json', await mcp(who.token, null, { raw: '{nope' }), 400],
      ['too large', await mcp(who.token, null, { raw: ' '.repeat(4 * 1024 * 1024) }), 400],
      ['no row for the method', await mcp(who.token, null, { method: 'DELETE' }), 403],
    ] as const;
    for (const [label, response, status] of cases) {
      expect(response.status, label).toBe(status);
      expectRpcError(response, label);
    }
  });
});
