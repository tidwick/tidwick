// The /mcp gate through the built Worker: every way a bearer can be wrong, the scope each tool needs, the names a
// model might try that are not tools, and that the person's own pages and Actions never take a bearer.
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import {
  call2025,
  mcp,
  mintAgent,
  rpc2025,
  tool,
  type Agent,
  type AgentOptions,
} from '../../test/helpers/agent';
import { ADMIN, ACCOUNTING, offboard } from '../../test/helpers/auth';
import { booking, WEEK } from '../../test/helpers/booking';
import { caller, getPage, ORIGIN, rpc } from '../../test/helpers/callers';
import { eventsAfter, headSeq } from '../../test/helpers/reference';
import { TOOLS } from '../routes';

async function agent(options: AgentOptions = {}): Promise<Agent> {
  return mintAgent((await booking()).who.personId, options);
}

const ARGS: Record<string, Record<string, unknown>> = {
  list_projects: {},
  get_week: { weekStart: WEEK },
  save_entries: { weekStart: WEEK, cells: [{ rowId: 'x', day: 0, hours: 1 }] },
  add_row: { weekStart: WEEK, projectId: 'x', taskCodeId: 'x' },
  copy_last_week: { weekStart: WEEK },
  remove_row: { weekStart: WEEK, rowId: 'x' },
  submit_week: { weekStart: WEEK },
};

describe('a bearer that is not a live access token is a 401 with a challenge and no tool runs', () => {
  it('no token, a malformed one and an unknown one', async () => {
    const none = await mcp(null, rpc2025('tools/list'));
    expect(none.status).toBe(401);
    expect(none.headers.get('www-authenticate')).toBe(
      'Bearer realm="tidwick", resource_metadata="http://localhost:4321/.well-known/oauth-protected-resource"',
    );
    expect(none.body).toMatchObject({ error: { code: expect.any(Number) as number } });
    expect((none.body as { error: { data?: unknown } }).error.data).toBeUndefined();
    for (const token of ['x', 'a'.repeat(42), 'a'.repeat(44), 'a'.repeat(43), 'a b']) {
      const response = await mcp(token, rpc2025('tools/list'));
      expect(response.status, token).toBe(401);
      expect(response.headers.get('www-authenticate')).toContain('error="invalid_token"');
      expect(response.body).toMatchObject({
        jsonrpc: '2.0',
        id: null,
        error: { data: { error: 'invalid_token' } },
      });
    }
  });

  it('an expired token, a revoked grant and a token stored under another kind of hash', async () => {
    for (const options of [
      { life: -1000 },
      { revoked: true },
      { kind: 'agent_refresh' as const },
    ]) {
      const who = await agent(options);
      const response = await mcp(who.token, call2025('list_projects'));
      expect(response.status, JSON.stringify(options)).toBe(401);
    }
    expect((await mcp((await agent()).token, call2025('list_projects'))).status).toBe(200);
  });

  it('a session id or an enrolment token presented as a bearer finds nothing', async () => {
    const who = await caller();
    expect((await mcp(who.raw, rpc2025('tools/list'))).status).toBe(401);
  });

  it('an offboarded person’s token fails at the tool, with no data', async () => {
    const who = await agent();
    await offboard(who.personId);
    const response = await tool(who, 'get_week', { weekStart: WEEK });
    expect(response).toMatchObject({ isError: true, data: { error: 'forbidden' } });
  });
});

describe('the scope a tool needs', () => {
  it('a grant without the scope is a 403 insufficient_scope naming it, and nothing is written', async () => {
    const grants: { name: string; scope: string; who: Agent }[] = [];
    for (const [name, { scope }] of Object.entries(TOOLS)) {
      const others = ['read', 'write', 'submit'].filter((s) => s !== scope);
      grants.push({ name, scope, who: await agent({ scopes: others }) });
    }
    const seq = await headSeq();
    for (const { name, scope, who } of grants) {
      const response = await mcp(who.token, call2025(name, ARGS[name]));
      expect(response.status, name).toBe(403);
      expect(response.headers.get('www-authenticate'), name).toContain(
        `error="insufficient_scope", scope="${scope}"`,
      );
      expect(response.body, name).toMatchObject({
        error: { data: { error: 'insufficient_scope', scope } },
      });
    }
    expect(await eventsAfter(seq)).toEqual([]);
  });

  it('a grant with no scopes, or only an unknown one, can call nothing', async () => {
    for (const scopes of [[], ['root'], ['approve']]) {
      const who = await agent({ scopes });
      for (const name of Object.keys(TOOLS)) {
        expect((await mcp(who.token, call2025(name, ARGS[name]))).status, name).toBe(403);
      }
    }
  });
});

describe('a tool is only what TOOLS names', () => {
  it('approve, return, export and every other name a model might try is an unknown tool', async () => {
    const who = await agent();
    for (const name of [
      'approve',
      'submission.approve',
      'submission.return',
      'return_week',
      'export_csv',
      'people.setRoles',
      'create_project',
      'create_client',
      'toString',
      '__proto__',
      'constructor',
      '',
    ]) {
      const response = await mcp(who.token, call2025(name));
      expect(response.status, name).toBe(200);
      expect(response.body.error, name).toMatchObject({ code: -32602, message: 'Unknown tool' });
    }
    const odd = await mcp(who.token, rpc2025('tools/call', { arguments: {} }));
    expect(odd.body.error).toMatchObject({ code: -32602 });
  });

  it('an admin’s token reaches no more than a member’s: a steward cannot approve through it', async () => {
    const admin = await caller([ADMIN, ACCOUNTING]);
    const who = await mintAgent(admin.personId);
    const response = await mcp(
      who.token,
      call2025('approve', { person: admin.personId, weekStart: WEEK }),
    );
    expect(response.body.error).toMatchObject({ code: -32602 });
    expect((await tool(who, 'list_projects')).data).toEqual({ projects: [] });
  });
});

describe('what reaches /mcp before its handler', () => {
  it('a mismatched Origin is refused, an absent one passes, and the cookie and bearer together are refused', async () => {
    const who = await agent();
    const foreign = await mcp(who.token, rpc2025('ping'), { origin: 'https://evil.example' });
    expect(foreign.status).toBe(403);
    expect(await mcp(who.token, rpc2025('ping'), { origin: null })).toMatchObject({ status: 200 });
    expect(await mcp(who.token, rpc2025('ping'), { origin: ORIGIN })).toMatchObject({
      status: 200,
    });
    const person = await caller();
    const both = await mcp(who.token, rpc2025('ping'), {
      headers: { cookie: `__Host-tidwick-session=${person.raw}` },
      origin: null,
    });
    expect(both.status).toBe(403);
  });

  it('an oversized body is refused, with or without a token, before it is parsed', async () => {
    const who = await agent();
    const big = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'ping',
      pad: 'x'.repeat(4 * 1024 * 1024),
    });
    for (const token of [who.token, null]) {
      const response = await mcp(token, null, { raw: big });
      expect(response.status).toBe(400);
    }
  });

  it('the carve-out is for /mcp alone: an Action with no Origin is still refused', async () => {
    const who = await agent();
    const response = await mcp(who.token, {}, { origin: null });
    expect(response.status).not.toBe(403);
    const action = await postAction('/_actions/entries.save', who.token);
    expect(action.status).toBe(403);
  });
});

function postAction(path: string, token: string): Promise<Response> {
  return exports.default.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    }),
  );
}

describe('a bearer anywhere but /mcp is nothing', () => {
  it('on an Action, the approvals page and the account page it acts as no one at all', async () => {
    const who = await agent();
    const bearer = { authorization: `Bearer ${who.token}` };
    const get = (path: string, withBearer: boolean) =>
      exports.default.fetch(
        new Request(`${ORIGIN}${path}`, {
          headers: withBearer ? bearer : {},
          redirect: 'manual',
        }),
      );
    for (const path of ['/approvals', '/account', '/week/2026-01-05', '/audit']) {
      const [a, b] = [await get(path, true), await get(path, false)];
      expect(a.status, path).toBe(b.status);
      expect([303, 403], path).toContain(a.status);
    }
    for (const name of [
      'submission.approve',
      'submission.return',
      'entries.save',
      'people.setRoles',
    ]) {
      const post = (withBearer: boolean) =>
        exports.default.fetch(
          new Request(`${ORIGIN}/_actions/${name}`, {
            method: 'POST',
            headers: {
              origin: ORIGIN,
              'content-type': 'application/json',
              ...(withBearer ? bearer : {}),
            },
            body: '{}',
          }),
        );
      const [a, b] = [await post(true), await post(false)];
      expect(a.status, name).toBe(401);
      expect(await a.json(), name).toEqual(await b.json());
    }
    expect((await getPage('/account', null)).status).toBe(303);
    expect((await rpc('submission.approve', null)).status).toBe(401);
  });
});
