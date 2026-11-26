// Refreshing and the token kinds: a refresh token rotates and its reuse cuts the grant (SEC-63); tokens of one kind
// never pass as another, and a bearer sent anywhere but `/mcp` is an anonymous request (SEC-64).
import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call2025, mcp } from '../../test/helpers/agent';
import { caller, getPage, ORIGIN } from '../../test/helpers/callers';
import { CLIENT_ID, connect, document, stubDocuments, token } from '../../test/helpers/oauth';
import { rowsOf } from '../db/test-support-agents';
import { currentEnv } from '../lib/env';

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

describe('refreshing', () => {
  it('rotates the refresh token and the access token, and keeps the grant', async () => {
    const who = await caller();
    const { tokens } = await connect(who);
    const next = await refresh(tokens.refresh_token ?? '');
    expect(next.status).toBe(200);
    const body = await next.json<Record<string, string>>();
    expect(body.refresh_token).not.toBe(tokens.refresh_token);
    expect((await list(body.access_token ?? '')).status).toBe(200);
    expect((await list(tokens.access_token ?? '')).status).toBe(200);
    expect((await refresh(body.refresh_token ?? '', { scope: 'read' })).status).toBe(200);
  });

  it('SEC-63 reuse of a rotated refresh token revokes the grant, the newest tokens included', async () => {
    const who = await caller();
    const { tokens } = await connect(who);
    const next = await (await refresh(tokens.refresh_token ?? '')).json<Record<string, string>>();
    const reused = await refresh(tokens.refresh_token ?? '');
    expect(await error(reused)).toBe('invalid_grant');
    expect((await grantOf(who.personId))?.revoked_at).not.toBeNull();
    expect((await list(next.access_token ?? '')).status).toBe(401);
    expect((await refresh(next.refresh_token ?? '')).status).toBe(400);
  });

  it('is refused for another client and for a wider scope than the grant', async () => {
    const who = await caller();
    const other = await connect(who);
    expect(
      await error(
        await refresh(other.tokens.refresh_token ?? '', {
          client_id: 'https://other.example/m.json',
        }),
      ),
    ).toBe('invalid_grant');
    const wide = await connect(who);
    expect(
      await error(await refresh(wide.tokens.refresh_token ?? '', { scope: 'read write submit' })),
    ).toBe('invalid_scope');
  });

  it('gives a refresh token 30 idle days, and is refused once they have passed', async () => {
    const who = await caller();
    const { tokens } = await connect(who);
    const id = String((await latestGrant(who.personId))?.id);
    const rows = (await rowsOf(env.DB, 'agent_token')).filter(
      (t) => t.grant_id === id && t.kind === 'refresh',
    );
    expect(Number(rows[0]?.expires_at) - Date.now()).toBeLessThanOrEqual(
      currentEnv().POLICY.mcpRefreshIdleMs,
    );
    expect(Number(rows[0]?.expires_at) - Date.now()).toBeGreaterThan(
      currentEnv().POLICY.mcpRefreshIdleMs - 60_000,
    );
    await env.DB.exec(
      `UPDATE agent_token SET expires_at = 1 WHERE grant_id = '${id}' AND kind = 'refresh'`,
    );
    expect(await error(await refresh(tokens.refresh_token ?? ''))).toBe('invalid_grant');
  });

  it('ends a grant 90 days after it was approved, whatever the refresh token says', async () => {
    const who = await caller();
    const { tokens } = await connect(who);
    const id = String((await latestGrant(who.personId))?.id);
    await env.DB.exec(
      `UPDATE agent_grant SET expires_at = ${String(Date.now() - 1)} WHERE id = '${id}'`,
    );
    expect(await error(await refresh(tokens.refresh_token ?? ''))).toBe('invalid_grant');
    expect((await list(tokens.access_token ?? '')).status).toBe(401);
  });
});

describe('SEC-64 token kinds and routes', () => {
  it('SEC-64 a refresh token or a code is no access token, and an access token is no refresh token or code', async () => {
    const who = await caller();
    const { tokens, code } = await connect(who);
    for (const wrong of [tokens.refresh_token ?? '', code])
      expect((await list(wrong)).status).toBe(401);
    expect(await error(await refresh(tokens.access_token ?? ''))).toBe('invalid_grant');
    expect((await list(tokens.access_token ?? '')).status).toBe(200);
  });

  it('SEC-64 a bearer sent to any route but /mcp is an anonymous request', async () => {
    const who = await caller();
    const { tokens } = await connect(who);
    for (const path of ['/week', '/account', '/approvals', '/oauth/authorize']) {
      const response = await bearerGet(path, tokens.access_token ?? '');
      expect([303, 401, 403], path).toContain(response.status);
      expect(response.status === 303 ? response.headers.get('location') : '/login', path).toMatch(
        /^\/login/,
      );
    }
    expect((await getPage('/week', who)).status).toBe(200);
  });

  it('accepts a form with no Origin, refuses a foreign Origin, a JSON body and a GET', async () => {
    expect((await token({ grant_type: 'password' })).status).toBe(400);
    expect(
      (await token({ grant_type: 'password' }, { origin: 'https://evil.example' })).status,
    ).toBe(403);
    expect((await token({ grant_type: 'password' }, { origin: ORIGIN })).status).toBe(400);
    const json = await token(
      { grant_type: 'refresh_token' },
      { 'content-type': 'application/json' },
    );
    expect(await error(json)).toBe('invalid_request');
    expect((await getPage('/oauth/token', null)).status).toBe(405);
  });
});

function bearerGet(path: string, bearer: string): Promise<Response> {
  return exports.default.fetch(
    new Request(`${ORIGIN}${path}`, {
      headers: { authorization: `Bearer ${bearer}` },
      redirect: 'manual',
    }),
  );
}
