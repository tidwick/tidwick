// The token endpoint through the built Worker: a code for tokens, a refresh token for new ones, and every way a
// token is refused. A spent code or refresh token presented again cuts its grant (SEC-63). Tokens of one kind never
// pass as another: only an access token reaches `/mcp`.
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call2025, mcp } from '../../test/helpers/agent';
import { caller, ORIGIN } from '../../test/helpers/callers';
import {
  approve,
  CALLBACK,
  CLIENT_ID,
  connect,
  document,
  handoff,
  pkce,
  query,
  stubDocuments,
  token,
} from '../../test/helpers/oauth';
import { rowsOf } from '../db/test-support-agents';
import { DEFAULT_POLICY } from '../lib/policy';

let stub: ReturnType<typeof stubDocuments>;
beforeEach(() => {
  stub = stubDocuments({ [CLIENT_ID]: document() });
});
afterEach(() => stub.restore());

const list = (bearer: string) => mcp(bearer, call2025('list_projects'));
const refresh = (refresh_token: string, over: Record<string, string> = {}) =>
  token({ grant_type: 'refresh_token', refresh_token, client_id: CLIENT_ID, ...over });
const latestGrant = async (personId: string) =>
  (await rowsOf(env.DB, 'agent_grant')).findLast((g) => g.person_id === personId);
const grantOf = latestGrant;
const error = async (response: Response) => (await response.json<{ error: string }>()).error;

describe('exchanging a code', () => {
  it('gives an access token for /mcp, a refresh token and the granted scopes, with no cache', async () => {
    const who = await caller();
    const { response, tokens } = await connect(who);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(tokens).toMatchObject({
      token_type: 'Bearer',
      expires_in: DEFAULT_POLICY.mcpAccessMs / 1000,
      scope: 'read write',
    });
    expect((await list(tokens.access_token ?? '')).status).toBe(200);
    const grant = await grantOf(who.personId);
    expect(grant?.expires_at).toBe(Number(grant?.created_at) + DEFAULT_POLICY.mcpGrantMs);
  });

  it('SEC-63 holds the code to its PKCE verifier, client, redirect address and resource (negative case: the right ones pass)', async () => {
    const who = await caller();
    const wrongs: Record<string, string>[] = [
      { code_verifier: (await pkce()).verifier },
      { code_verifier: 'short' },
      { client_id: 'https://other.example/meta.json' },
      { redirect_uri: 'https://claude.ai/api/mcp/auth_callback/x' },
    ];
    for (const wrong of wrongs) {
      const pair = await pkce();
      const code =
        (await handoff(await approve(who, query(pair.challenge)))).searchParams.get('code') ?? '';
      const response = await token({
        grant_type: 'authorization_code',
        code,
        code_verifier: pair.verifier,
        redirect_uri: CALLBACK,
        client_id: CLIENT_ID,
        ...wrong,
      });
      expect(response.status, JSON.stringify(wrong)).toBe(400);
      expect(await error(response)).toBe('invalid_grant');
    }
    expect((await connect(who)).response.status).toBe(200);
    const pair = await pkce();
    const code =
      (await handoff(await approve(who, query(pair.challenge)))).searchParams.get('code') ?? '';
    const base = {
      grant_type: 'authorization_code',
      code,
      code_verifier: pair.verifier,
      redirect_uri: CALLBACK,
      client_id: CLIENT_ID,
    };
    const target = await token({ ...base, resource: `${ORIGIN}/week` });
    expect(await error(target)).toBe('invalid_target');
  });

  it('SEC-63 requires the real loopback address at the token request, not just the one in the client document', async () => {
    stub.restore();
    stub = stubDocuments({
      [CLIENT_ID]: document({ redirect_uris: ['http://127.0.0.1/callback'] }),
    });
    const who = await caller();
    const real = 'http://127.0.0.1:53911/callback';
    const pair = await pkce();
    const back = await handoff(await approve(who, query(pair.challenge, { redirect_uri: real })));
    expect(back.origin).toBe('http://127.0.0.1:53911');
    const code = back.searchParams.get('code') ?? '';
    const send = (redirect_uri: string) =>
      token({
        grant_type: 'authorization_code',
        code,
        code_verifier: pair.verifier,
        redirect_uri,
        client_id: CLIENT_ID,
      });
    expect((await send('http://127.0.0.1:60000/callback')).status).toBe(400);
    const second = await connect(who, { redirect_uri: real });
    expect(second.response.status).toBe(200);
  });

  it('SEC-63 reuse of a code answers invalid_grant, revokes the grant and so its tokens, and is audited', async () => {
    const who = await caller();
    const first = await connect(who);
    expect(first.response.status).toBe(200);
    const again = await token({
      grant_type: 'authorization_code',
      code: first.code,
      code_verifier: first.pair.verifier,
      redirect_uri: CALLBACK,
      client_id: CLIENT_ID,
    });
    expect(await error(again)).toBe('invalid_grant');
    expect((await grantOf(who.personId))?.revoked_at).not.toBeNull();
    expect((await list(first.tokens.access_token ?? '')).status).toBe(401);
    expect((await refresh(first.tokens.refresh_token ?? '')).status).toBe(400);
    const events = (await rowsOf(env.DB, 'audit_event')).filter(
      (e) => e.action === 'agents.revoke' && e.target === `person:${who.personId}`,
    );
    expect(events).toHaveLength(1);
  });

  it('an expired code, an unknown code and a missing field are refused', async () => {
    const who = await caller();
    const pair = await pkce();
    const code =
      (await handoff(await approve(who, query(pair.challenge)))).searchParams.get('code') ?? '';
    await env.DB.exec(
      `UPDATE agent_token SET expires_at = 1 WHERE kind = 'code' AND grant_id = '${String((await grantOf(who.personId))?.id)}'`,
    );
    const base = {
      grant_type: 'authorization_code',
      code_verifier: pair.verifier,
      redirect_uri: CALLBACK,
      client_id: CLIENT_ID,
    };
    expect(await error(await token({ ...base, code }))).toBe('invalid_grant');
    expect(await error(await token({ ...base, code: 'a'.repeat(43) }))).toBe('invalid_grant');
    expect(await error(await token({ ...base }))).toBe('invalid_request');
    expect(await error(await token({ grant_type: 'password' }))).toBe('unsupported_grant_type');
    expect(await error(await token({}))).toBe('unsupported_grant_type');
  });
});
