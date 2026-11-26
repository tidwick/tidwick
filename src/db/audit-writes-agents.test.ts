// The agent token Actions `agents.mint`, `agents.grant` and `agents.revoke`: one event each by the person who ran it, holding the
// grant, label, scopes and end date, and never the token or its hash.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { eventsAfter, headSeq, memberScope } from '../../test/helpers/reference';
import { mintPersonalToken, revokeOwnGrant } from '../auth/agent-personal';
import { keyedHash } from '../auth/tokens';
import { currentEnv } from '../lib/env';
import { grantAccess } from '../oauth/grant';

const NOW = Date.UTC(2026, 5, 1);

describe('agent tokens are audited', () => {
  it("'agents.mint' adds one event with the grant, label, scopes and end, and no token text", async () => {
    const { id, scope } = await memberScope();
    const secret = currentEnv().SESSION_SECRET;
    const head = await headSeq();
    const minted = await mintPersonalToken(
      scope,
      env.DB,
      secret,
      id,
      { label: 'Laptop', scopes: ['read', 'write'], days: 30 },
      NOW,
    );
    const events = await eventsAfter(head);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'agents.mint',
      target: `person:${id}`,
      actor_id: id,
    });
    expect(JSON.parse(events[0]?.after_json ?? '{}')).toEqual({
      grant: minted.grantId,
      label: 'Laptop',
      scopes: ['read', 'write'],
      expiresAt: NOW + 30 * 86_400_000,
    });
    const text = JSON.stringify(events);
    expect(text).not.toContain(minted.token);
    expect(text).not.toContain(await keyedHash(secret, 'agent_access', minted.token));
  });

  it("'agents.grant' adds one event with the client and scopes, never the code, and replaces the client's earlier grant", async () => {
    const { id, scope } = await memberScope();
    const secret = currentEnv().SESSION_SECRET;
    const request = {
      client: { id: 'https://client.example/meta.json', name: 'Example Agent', redirectUris: [] },
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      state: null,
      challenge: 'c'.repeat(43),
      offered: ['read', 'write', 'submit'],
    } as const;
    const first = await grantAccess(scope, env.DB, secret, id, request, ['read'], NOW);
    const head = await headSeq();
    const code = await grantAccess(scope, env.DB, secret, id, request, ['read', 'write'], NOW + 1);
    const events = await eventsAfter(head);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'agents.grant',
      target: `person:${id}`,
      actor_id: id,
    });
    expect(JSON.parse(events[0]?.after_json ?? '{}')).toMatchObject({
      client: request.client.id,
      scopes: ['read', 'write'],
    });
    expect(JSON.parse(events[0]?.before_json ?? '{}')).toEqual({ replaced: [expect.any(String)] });
    expect(JSON.stringify(events)).not.toContain(code);
    expect(JSON.stringify(events)).not.toContain(await keyedHash(secret, 'agent_code', code));
    expect(first).not.toBe(code);
  });

  it("'agents.revoke' adds one event naming the grant, and a second revoke of it adds none", async () => {
    const { id, scope } = await memberScope();
    const { grantId } = await mintPersonalToken(
      scope,
      env.DB,
      currentEnv().SESSION_SECRET,
      id,
      { label: 'Laptop', scopes: ['read'], days: 7 },
      NOW,
    );
    const head = await headSeq();
    await revokeOwnGrant(scope, env.DB, id, grantId, NOW + 1);
    const events = await eventsAfter(head);
    expect(events.map((e) => [e.action, e.before_json])).toEqual([
      ['agents.revoke', JSON.stringify({ grants: [grantId] })],
    ]);
    await expect(revokeOwnGrant(scope, env.DB, id, grantId, NOW + 2)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(await eventsAfter(head)).toHaveLength(1);
  });
});
