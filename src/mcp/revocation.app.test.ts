// A token dies with the access it came from: each way a person's own access is cut, through the real Action, also
// ends their agent at /mcp, and one person's revocation leaves another person's agent alone.
import { describe, expect, it } from 'vitest';
import { call2025, mcp, mintAgent, type Agent } from '../../test/helpers/agent';
import { ADMIN, withPasskey } from '../../test/helpers/auth';
import { caller, rpc, rpcForm, type Caller } from '../../test/helpers/callers';

async function live(token: Agent): Promise<boolean> {
  return (await mcp(token.token, call2025('list_projects'))).status === 200;
}

async function member(): Promise<{ who: Caller; agent: Agent }> {
  const who = await caller();
  return { who, agent: await mintAgent(who.personId) };
}

describe('revoking access through the Actions kills a live token', () => {
  it('people.reenrol and people.offboard, as an admin with a fresh passkey assertion', async () => {
    const admin = await caller([ADMIN]);
    for (const name of ['people.reenrol', 'people.offboard']) {
      const { who, agent } = await member();
      const bystander = await member();
      expect(await live(agent), name).toBe(true);
      const response = await rpcForm(name, admin, { id: who.personId });
      expect(response.status, name).toBe(200);
      expect(await live(agent), name).toBe(false);
      expect(await live(bystander.agent), name).toBe(true);
    }
  });

  it('auth.logoutOthers, even with no other session to end', async () => {
    const { who, agent } = await member();
    expect(await live(agent)).toBe(true);
    expect((await rpcForm('auth.logoutOthers', who)).status).toBe(200);
    expect(await live(agent)).toBe(false);
  });

  it('auth.revokePasskey, with a second passkey left', async () => {
    const { who, agent } = await member();
    const first = await withPasskey(who.personId);
    await withPasskey(who.personId);
    expect(await live(agent)).toBe(true);
    expect((await rpcForm('auth.revokePasskey', who, { id: first })).status).toBe(200);
    expect(await live(agent)).toBe(false);
  });

  it('a refused revocation leaves the agent alone: the last passkey stays, and so does its agent', async () => {
    const { who, agent } = await member();
    const only = await withPasskey(who.personId);
    const refused = await rpcForm('auth.revokePasskey', who, { id: only });
    expect(refused.status).toBe(409);
    expect(await live(agent)).toBe(true);
    expect((await rpc('people.offboard', who, { id: who.personId })).status).toBe(403);
    expect(await live(agent)).toBe(true);
  });
});
