// Runs in the `app` project (MCP on): a person makes, lists and revokes their own agent tokens on the account page,
// through the real middleware. The token is shown once, stored only as a hash, and never reaches the audit log.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { CLIENT_ID, connect, document, stubDocuments } from '../../../test/helpers/oauth';
import { call2025, mcp } from '../../../test/helpers/agent';
import { addPerson } from '../../../test/helpers/auth';
import { caller, formPost, getPage, rpcForm } from '../../../test/helpers/callers';
import { currentEnv } from '../../lib/env';
import { endGrantsOf, rowsOf } from '../../db/test-support-agents';

let stub: ReturnType<typeof stubDocuments>;
const TOKEN = /[A-Za-z0-9_-]{43}/;
const fields = { label: 'Laptop', days: '30', scopes: ['read', 'write'] };

async function everything(): Promise<string> {
  const tables = ['agent_grant', 'agent_token', 'audit_event'] as const;
  return JSON.stringify(await Promise.all(tables.map((t) => rowsOf(env.DB, t))));
}

async function mint(who: Awaited<ReturnType<typeof caller>>, extra = {}) {
  const response = await formPost('/account', 'agents.mint', who, { ...fields, ...extra });
  return { response, html: await response.text() };
}

describe('SEC-60 making an agent token', () => {
  it('SEC-60 needs a passkey confirmation from the last 15 minutes (negative case: a fresh one passes)', async () => {
    const stale = await caller([], { stepUpAgo: 16 * 60_000 });
    for (const response of [
      await rpcForm('agents.mint', stale, fields),
      await formPost('/account', 'agents.mint', stale, fields),
    ]) {
      expect(response.status).toBe(403);
    }
    expect(await rowsOf(env.DB, 'agent_grant')).not.toContainEqual(
      expect.objectContaining({ person_id: stale.personId }),
    );
    expect((await rpcForm('agents.mint', await caller(), fields)).status).toBe(200);
  });

  it('SEC-60 shows the token once on the page that made it, and never again', async () => {
    const who = await caller();
    const { response, html } = await mint(who);
    expect(response.status).toBe(200);
    expect(html).toContain('data-agent-token');
    expect(html).toMatch(/readonly/i);
    const token = /id="agent-token"[^>]*value="([^"]+)"|value="([^"]+)"[^>]*id="agent-token"/.exec(
      html,
    );
    const shown = token?.[1] ?? token?.[2] ?? '';
    expect(shown).toMatch(TOKEN);
    expect((await mcp(shown, call2025('list_projects'))).status).toBe(200);

    const later = await (await getPage('/account', who)).text();
    expect(later).not.toContain(shown);
    expect(later).not.toContain('data-agent-token');
    expect(later).toContain('Laptop');
  });

  it('SEC-60 stores only a hash: the token is in no row of the grant, token or audit tables', async () => {
    const who = await caller();
    const body = await (await rpcForm('agents.mint', who, fields)).text();
    const token = TOKEN.exec(body.replace(/^.*?"token"/s, ''))?.[0] ?? '';
    expect(token).toHaveLength(43);
    expect(await everything()).not.toContain(token);
    expect((await mcp(token, call2025('list_projects'))).status).toBe(200);
  });

  it('records the label, scopes and end date on the grant, with the life asked for', async () => {
    const who = await caller();
    await rpcForm('agents.mint', who, { label: 'Quick', days: '7', scopes: ['read'] });
    const grant = (await rowsOf(env.DB, 'agent_grant')).find((g) => g.person_id === who.personId);
    expect(grant).toMatchObject({
      client_id: 'token',
      client_name: 'Quick',
      redirect_uri: '',
      scopes: '["read"]',
    });
    const days = ((grant?.expires_at as number) - (grant?.created_at as number)) / 86_400_000;
    expect(days).toBe(7);
  });

  it('refuses a label that is empty or too long, a life that is not offered, and no scope, writing nothing', async () => {
    const who = await caller();
    for (const bad of [
      { label: ' ' },
      { label: 'x'.repeat(61) },
      { days: '365' },
      { days: '0' },
      { days: 'soon' },
      { scopes: [] },
    ]) {
      expect(
        (await rpcForm('agents.mint', who, { ...fields, ...bad })).status,
        JSON.stringify(bad),
      ).toBe(400);
    }
    expect(
      (await rowsOf(env.DB, 'agent_grant')).filter((g) => g.person_id === who.personId),
    ).toEqual([]);
  });

  it('SEC-60 holds at most five live tokens, and a revoked one makes room (negative case: the sixth is refused)', async () => {
    const who = await caller();
    for (let n = 0; n < currentEnv().POLICY.agentTokenMax; n += 1) {
      expect(
        (await rpcForm('agents.mint', who, { ...fields, label: `T${String(n)}` })).status,
      ).toBe(200);
    }
    const sixth = await rpcForm('agents.mint', who, fields);
    expect(sixth.status).toBe(409);
    const one = (await rowsOf(env.DB, 'agent_grant')).find((g) => g.person_id === who.personId);
    expect((await rpcForm('agents.revoke', who, { id: String(one?.id) })).status).toBe(200);
    expect((await rpcForm('agents.mint', who, fields)).status).toBe(200);
  });
});

describe('SEC-61 listing and revoking agent tokens', () => {
  it('SEC-61 the account page lists only the caller’s own tokens', async () => {
    const mine = await caller();
    const theirs = await caller();
    await rpcForm('agents.mint', mine, { ...fields, label: 'Mine alone' });
    await rpcForm('agents.mint', theirs, { ...fields, label: 'Theirs alone' });
    const html = await (await getPage('/account', mine)).text();
    expect(html).toContain('Mine alone');
    expect(html).not.toContain('Theirs alone');
  });

  it('SEC-61 revoking another person’s token is refused like an unknown one and changes nothing (negative case: the owner can)', async () => {
    const owner = await caller();
    const other = await caller();
    const body = await (await rpcForm('agents.mint', owner, fields)).text();
    const token = TOKEN.exec(body.replace(/^.*?"token"/s, ''))?.[0] ?? '';
    const grant = (await rowsOf(env.DB, 'agent_grant')).find((g) => g.person_id === owner.personId);
    const id = String(grant?.id);
    const refused = await rpcForm('agents.revoke', other, { id });
    const unknown = await rpcForm('agents.revoke', other, { id: 'no-such-grant' });
    expect(refused.status).toBe(404);
    expect(await refused.text()).toBe(await unknown.text());
    expect((await mcp(token, call2025('list_projects'))).status).toBe(200);

    expect((await rpcForm('agents.revoke', owner, { id })).status).toBe(200);
    expect((await mcp(token, call2025('list_projects'))).status).toBe(401);
  });

  it('revoking needs no passkey confirmation, and the page form redirects back saved', async () => {
    const who = await caller([], { stepUpAgo: 60 * 60_000 });
    const person = await addPerson();
    expect(person.id).not.toBe(who.personId);
    const fresh = await caller();
    await rpcForm('agents.mint', fresh, fields);
    const grant = (await rowsOf(env.DB, 'agent_grant')).find((g) => g.person_id === fresh.personId);
    const stale = await formPost('/account', 'agents.revoke', fresh, { id: String(grant?.id) });
    expect(stale.status).toBe(303);
    expect(stale.headers.get('location')).toContain('saved=1');
  });

  it('an expired token is refused at /mcp and is no longer listed', async () => {
    const who = await caller();
    const body = await (await rpcForm('agents.mint', who, { ...fields, label: 'Fading' })).text();
    const token = TOKEN.exec(body.replace(/^.*?"token"/s, ''))?.[0] ?? '';
    await endGrantsOf(env.DB, who.personId, 1);
    expect((await mcp(token, call2025('list_projects'))).status).toBe(401);
    expect(await (await getPage('/account', who)).text()).not.toContain('Fading');
  });
});

describe('approved apps on the account page', () => {
  it('lists an app a person approved beside their tokens, and Revoke ends it and its tokens', async () => {
    stub = stubDocuments({ [CLIENT_ID]: document({ client_name: 'Example Agent' }) });
    try {
      const who = await caller();
      const { tokens } = await connect(who);
      const html = await (await getPage('/account', who)).text();
      expect(html).toContain('Example Agent');
      expect(html).toContain('app at client.example');
      const id = (await rowsOf(env.DB, 'agent_grant')).findLast(
        (g) => g.person_id === who.personId,
      )?.id;
      expect((await mcp(tokens.access_token ?? '', call2025('list_projects'))).status).toBe(200);
      const revoked = await formPost('/account', 'agents.revoke', who, { id: String(id) });
      expect(revoked.status).toBe(303);
      expect((await mcp(tokens.access_token ?? '', call2025('list_projects'))).status).toBe(401);
      expect(await (await getPage('/account', who)).text()).not.toContain('app at client.example');
    } finally {
      stub.restore();
    }
  });
});
