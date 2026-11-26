// The protocol through the built Worker: raw requests drive both eras and pin every header and version refusal,
// the transport's methods, and the golden tool list a model reads.
import { describe, expect, it } from 'vitest';
import {
  call2025,
  mcp,
  MODERN,
  mintAgent,
  rpc2025,
  rpc2026,
  type Agent,
} from '../../test/helpers/agent';
import { booking, WEEK } from '../../test/helpers/booking';
import { TOOLS } from '../routes';

async function agent(): Promise<Agent> {
  return mintAgent((await booking()).who.personId);
}

const error = (body: Record<string, unknown>) => body.error as { code: number; data?: unknown };

describe('both eras over raw requests', () => {
  it('2025: initializes, lists the tools in TOOLS and calls one', async () => {
    const who = await agent();
    const init = await mcp(
      who.token,
      rpc2025('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'tidwick-test', version: '0.0.0' },
      }),
    );
    const result = init.body.result as { serverInfo: { name: string }; instructions: string };
    expect(result.serverInfo.name).toBe('tidwick');
    expect(result.instructions).toMatch(/data written by users/);
    const listed = await mcp(who.token, rpc2025('tools/list'));
    const names = (listed.body.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(names.toSorted()).toEqual(Object.keys(TOOLS).toSorted());
    const called = await mcp(who.token, call2025('get_week', { weekStart: WEEK }));
    const week = called.body.result as { isError?: boolean; structuredContent: unknown };
    expect(week.isError).toBeFalsy();
    expect(week.structuredContent).toMatchObject({ weekStart: WEEK, state: 'draft', rows: [] });
  });

  it('2026: serves the same tools with no handshake', async () => {
    const who = await agent();
    const list = rpc2026('tools/list');
    const listed = await mcp(who.token, list.message, { headers: list.headers });
    const names = (listed.body.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(names.toSorted()).toEqual(Object.keys(TOOLS).toSorted());
    const get = rpc2026('tools/call', { name: 'get_week', arguments: { weekStart: WEEK } });
    const ok = await mcp(who.token, get.message, { headers: get.headers });
    expect((ok.body.result as { structuredContent: unknown }).structuredContent).toMatchObject({
      weekStart: WEEK,
    });
    const bad = rpc2026('tools/call', { name: 'get_week', arguments: { weekStart: 'x' } });
    const refused = await mcp(who.token, bad.message, { headers: bad.headers });
    expect((refused.body.result as { isError: boolean }).isError).toBe(true);
  });
});

describe('the 2026 headers and versions', () => {
  it('serves a request whose headers match its body, with no session header and no handshake', async () => {
    const who = await agent();
    const { message, headers } = rpc2026('tools/list');
    const ok = await mcp(who.token, message, { headers });
    expect(ok.status).toBe(200);
    expect((ok.body.result as { tools: unknown[] }).tools).toHaveLength(Object.keys(TOOLS).length);
    expect(ok.headers.get('mcp-session-id')).toBeNull();
  });

  it('refuses a missing or mismatched header with -32020 on 400, whichever one it is', async () => {
    const who = await agent();
    const call = rpc2026('tools/call', { name: 'get_week', arguments: { weekStart: WEEK } });
    const wrong = (h: Record<string, string>, drop: string) =>
      Object.fromEntries(Object.entries(h).filter(([key]) => key !== drop));
    const cases: Record<string, string>[] = [
      wrong(call.headers, 'mcp-protocol-version'),
      wrong(call.headers, 'mcp-method'),
      wrong(call.headers, 'mcp-name'),
      { ...call.headers, 'mcp-method': 'tools/list' },
      { ...call.headers, 'mcp-name': 'submit_week' },
      { ...call.headers, 'mcp-protocol-version': '2025-06-18' },
    ];
    for (const headers of cases) {
      const response = await mcp(who.token, call.message, { headers });
      expect(response.status, JSON.stringify(headers)).toBe(400);
      expect(error(response.body).code).toBe(-32020);
    }
  });

  it('refuses an unknown version with -32022 naming what it supports, in the body or the header', async () => {
    const who = await agent();
    const meta = { 'io.modelcontextprotocol/protocolVersion': '2099-01-01' };
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: meta } };
    const inBody = await mcp(who.token, body, {
      headers: { 'mcp-protocol-version': '2099-01-01' },
    });
    expect(inBody.status).toBe(400);
    expect(error(inBody.body)).toMatchObject({
      code: -32022,
      data: {
        requested: '2099-01-01',
        supported: [MODERN, '2025-11-25', '2025-06-18', '2025-03-26'],
      },
    });
    const inHeader = await mcp(who.token, rpc2025('tools/list'), {
      headers: { 'mcp-protocol-version': '1999-01-01' },
    });
    expect(inHeader.status).toBe(400);
    expect(error(inHeader.body).code).toBe(-32022);
  });

  it('refuses a 2026 version header with no envelope, and a method header with no version at all', async () => {
    const who = await agent();
    const bare = await mcp(who.token, rpc2025('tools/list'), {
      headers: { 'mcp-protocol-version': MODERN },
    });
    expect(bare.status).toBe(400);
    expect(error(bare.body).code).toBe(-32602);
    const half = await mcp(who.token, rpc2025('tools/list'), {
      headers: { 'mcp-method': 'tools/list' },
    });
    expect(error(half.body).code).toBe(-32020);
  });
});

describe('the transport', () => {
  it('a GET is 405 allowing POST, a DELETE has no row and is 403, and neither reads a token', async () => {
    const who = await agent();
    const get = await mcp(who.token, null, { method: 'GET' });
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    const gone = await mcp(who.token, null, { method: 'DELETE' });
    expect(gone.status).toBe(403);
    expect((await mcp(null, null, { method: 'GET' })).status).toBe(405);
  });

  it('answers a notification with 202 and nothing, ping with {}, and an unknown method with -32601', async () => {
    const who = await agent();
    const note = await mcp(who.token, { jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(note.status).toBe(202);
    expect((await mcp(who.token, rpc2025('ping'))).body.result).toEqual({});
    const unknown = await mcp(who.token, rpc2025('resources/list'));
    expect(error(unknown.body).code).toBe(-32601);
    const modernInit = rpc2026('initialize');
    const refused = await mcp(who.token, modernInit.message, { headers: modernInit.headers });
    expect(error(refused.body).code).toBe(-32601);
  });

  it('refuses a body that is not JSON-RPC, and a batch', async () => {
    const who = await agent();
    expect(error((await mcp(who.token, null, { raw: '{nope' })).body).code).toBe(-32700);
    for (const body of ['[]', '42', '{"jsonrpc":"1.0","method":"ping"}', '{"jsonrpc":"2.0"}']) {
      const response = await mcp(who.token, null, { raw: body });
      expect(response.status, body).toBe(400);
      expect(error(response.body).code).toBe(-32600);
    }
    const batch = await mcp(who.token, [rpc2025('ping'), rpc2025('ping')]);
    expect(error(batch.body).code).toBe(-32600);
  });
});

describe('tools/list is what a model reads', () => {
  it('equals the golden file, so a changed word is a reviewed diff', async () => {
    const who = await agent();
    const listed = await mcp(who.token, rpc2025('tools/list'));
    const tools = (listed.body.result as { tools: unknown[] }).tools;
    await expect(`${JSON.stringify(tools, null, 2)}\n`).toMatchFileSnapshot(
      '../../test/golden/mcp-tools.json',
    );
  });

  it('is the same for a grant that holds only the read scope', async () => {
    const full = await agent();
    const narrow = await mintAgent((await booking()).who.personId, { scopes: ['read'] });
    const a = await mcp(full.token, rpc2025('tools/list'));
    const b = await mcp(narrow.token, rpc2025('tools/list'));
    expect(b.body.result).toEqual(a.body.result);
    expect((await mcp(narrow.token, call2025('submit_week', { weekStart: WEEK }))).status).toBe(
      403,
    );
  });
});
