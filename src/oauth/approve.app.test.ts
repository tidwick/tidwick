// Which clients are offered for consent, and approving: the approve step through the built Worker, with the client's
// document stubbed. Approving is a member action behind a passkey confirmation and answers with a hand-off page,
// since Chrome cancels a redirect that follows a form POST under `form-action 'self'` (the CSP is left alone).
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { addPerson } from '../../test/helpers/auth';
import { caller, ORIGIN } from '../../test/helpers/callers';
import {
  approve,
  authorize,
  CALLBACK,
  CLIENT_ID,
  document,
  handoff,
  pkce,
  query,
  stubDocuments,
} from '../../test/helpers/oauth';
import { rowsOf } from '../db/test-support-agents';
import { currentEnv } from '../lib/env';

let stub: ReturnType<typeof stubDocuments>;
afterEach(() => stub.restore());
const serve = (doc = document()) => (stub = stubDocuments({ [CLIENT_ID]: doc }));

async function search(over = {}) {
  return query((await pkce()).challenge, over);
}

describe('SEC-61 which clients are offered for consent', () => {
  it('SEC-61 refuses a client document that is not an https address on 443, redirects, is over 5 KB or names an address', async () => {
    const who = await caller();
    const refused = [
      'http://client.example/meta.json',
      'https://client.example:8443/meta.json',
      'https://client.example/',
      'https://203.0.113.9/meta.json',
      'https://[2001:db8::1]/meta.json',
      'https://localhost/meta.json',
      'https://user:pw@client.example/meta.json',
      'https://client.example/meta.json#frag',
      'not a url',
    ];
    for (const id of refused) {
      stub = stubDocuments({ [id]: document({ client_id: id }) });
      const response = await authorize(who, await search({ client_id: id }));
      expect(response.status, id).toBe(400);
      expect(stub.fetched, id).toEqual([]);
      stub.restore();
    }
    serve();
    expect((await authorize(who, await search())).status).toBe(200);
    expect(stub.fetched[0]?.init).toMatchObject({ redirect: 'manual' });
  });

  it('SEC-61 refuses a document that redirects, is too large, is not JSON, names another address or is slow', async () => {
    const who = await caller();
    const big = Response.json(document({ client_name: 'x'.repeat(6000) }));
    const redirect = new Response(null, { status: 302, headers: { location: `${CLIENT_ID}2` } });
    for (const served of [
      redirect,
      big,
      new Response('<html>', { status: 200 }),
      new Response('', { status: 500 }),
      Response.json(document({ client_id: `${CLIENT_ID}x` })),
      Response.json(document({ redirect_uris: [] })),
      Response.json(document({ redirect_uris: [CALLBACK, 'ftp://x.example/cb'] })),
      Response.json(document({ redirect_uris: [`${CALLBACK}#f`] })),
      Response.json(document({ token_endpoint_auth_method: 'client_secret_basic' })),
    ]) {
      stub = stubDocuments({ [CLIENT_ID]: served });
      expect((await authorize(who, await search())).status).toBe(400);
      stub.restore();
    }
    stub = stubDocuments({});
    expect((await authorize(who, await search())).status).toBe(400);
  });

  it('SEC-61 refuses a client named Claude whose redirect is anywhere but claude.ai or this computer', async () => {
    const who = await caller();
    for (const redirect_uris of [
      ['https://evil.example/cb'],
      [CALLBACK, 'https://evil.example/cb'],
      ['https://claude.ai.evil.example/api/mcp/auth_callback'],
      ['http://evil.example/cb'],
    ]) {
      serve(document({ client_name: 'Claude', redirect_uris }));
      const response = await authorize(who, await search({ redirect_uri: redirect_uris[0] ?? '' }));
      expect(response.status, redirect_uris.join()).toBe(400);
      expect(await response.text()).toMatch(/does not accept|not allowed/);
      stub.restore();
    }
    serve(document({ client_name: 'Claude', redirect_uris: [CALLBACK, 'http://127.0.0.1/cb'] }));
    expect((await authorize(who, await search())).status).toBe(200);
  });
});

describe('approving', () => {
  it('SEC-62 needs a passkey confirmation (negative case: a fresh one passes) and writes nothing without it', async () => {
    serve();
    const stale = await caller([], { stepUpAgo: 16 * 60_000 });
    const q = await search();
    const refused = await approve(stale, q);
    expect(refused.status).toBe(403);
    expect(await rowsOf(env.DB, 'agent_grant')).not.toContainEqual(
      expect.objectContaining({ person_id: stale.personId }),
    );
    expect((await approve(await caller(), q)).status).toBe(200);
  });

  it('answers 200 with a hand-off page, never a redirect, whose address carries the code, state and issuer', async () => {
    serve();
    const who = await caller();
    const response = await approve(who, await search({ state: 'a b&c=d' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("form-action 'self'");
    const html = await response.clone().text();
    expect(html).toMatch(
      /<meta[^>]+http-equiv="refresh"[^>]+content="0;url=https:\/\/claude\.ai\//,
    );
    const back = await handoff(response);
    expect(`${back.origin}${back.pathname}`).toBe(CALLBACK);
    expect(back.searchParams.get('code')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(back.searchParams.get('state')).toBe('a b&c=d');
    expect(back.searchParams.get('iss')).toBe(ORIGIN);
  });

  it('stores the real redirect address, the ticked scopes only, and one audit event without the code', async () => {
    serve(document({ redirect_uris: ['http://127.0.0.1/callback'] }));
    const who = await caller();
    const real = 'http://127.0.0.1:53911/callback';
    const response = await approve(
      who,
      await search({ redirect_uri: real, scope: 'read write submit' }),
      ['read', 'submit'],
    );
    const code = (await handoff(response)).searchParams.get('code') ?? '';
    const grant = (await rowsOf(env.DB, 'agent_grant')).find((g) => g.person_id === who.personId);
    expect(grant).toMatchObject({
      redirect_uri: real,
      client_id: CLIENT_ID,
      client_name: 'Example Agent',
    });
    expect(JSON.parse(String(grant?.scopes))).toEqual(['read', 'submit']);
    const events = (await rowsOf(env.DB, 'audit_event')).filter(
      (e) => e.action === 'agents.grant' && e.target === `person:${who.personId}`,
    );
    expect(events).toHaveLength(1);
    expect(JSON.stringify(await rowsOf(env.DB, 'audit_event'))).not.toContain(code);
  });

  it('refuses an approval with nothing ticked, and one for a request the page was never shown', async () => {
    serve();
    const who = await caller();
    expect((await approve(who, await search(), [])).status).toBe(400);
    expect(
      (await approve(who, await search({ redirect_uri: 'https://evil.example/cb' }))).status,
    ).toBe(400);
    expect((await approve(who, await search({ scope: 'read' }), ['write'])).status).toBe(400);
    expect(await rowsOf(env.DB, 'agent_grant')).not.toContainEqual(
      expect.objectContaining({ person_id: who.personId }),
    );
  });

  it('a second approval for the same client replaces the first, and a live grant past AGENT_TOKEN_MAX is refused', async () => {
    serve();
    const who = await caller();
    await approve(who, await search());
    await approve(who, await search());
    const live = async () =>
      (await rowsOf(env.DB, 'agent_grant')).filter(
        (g) => g.person_id === who.personId && g.revoked_at === null,
      );
    expect(await live()).toHaveLength(1);
    const other = await addPerson();
    expect(other.id).not.toBe(who.personId);
    const max = currentEnv().POLICY.agentTokenMax;
    for (let i = 0; i < max; i += 1) {
      const id = `https://client${String(i)}.example/meta.json`;
      stub.restore();
      stub = stubDocuments({ [id]: document({ client_id: id }) });
      expect((await approve(who, await search({ client_id: id }))).status).toBe(
        i < max - 1 ? 200 : 409,
      );
    }
  });
});
