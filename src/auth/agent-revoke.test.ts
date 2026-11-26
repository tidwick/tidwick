// Every path that cuts a person's own access also cuts their agents: re-enrolment, offboarding, sign out
// everywhere and removing a passkey each revoke the grants and leave one agents.revoke event naming them.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { mintAgent, type Agent } from '../../test/helpers/agent';
import { addPerson, adminScope, T0, withPasskey } from '../../test/helpers/auth';
import { eventsAfter, headSeq } from '../../test/helpers/reference';
import { currentEnv } from '../lib/env';
import { grantByAccessHash, liveGrantIdsOf } from '../db/agent-grants';
import { systemScope } from '../db/scope';
import { newSession } from './session';
import { keyedHash } from './tokens';
import { logoutOthers } from './logout-others';
import { offboard } from './offboard';
import { reenrol } from './revoke';
import { revokeOwnPasskey } from './revoke-passkey';
import { DEFAULT_POLICY } from '../lib/policy';

const { SESSION_SECRET } = currentEnv();

async function person(): Promise<{ id: string; agent: Agent; second: Agent }> {
  const { id } = await addPerson();
  return { id, agent: await mintAgent(id), second: await mintAgent(id) };
}

async function works(agent: Agent): Promise<boolean> {
  const hash = await keyedHash(SESSION_SECRET, 'agent_access', agent.token);
  return (await grantByAccessHash(env.DB, hash, Date.now())) !== null;
}

async function revoked(seq: number, grants: Agent[]): Promise<void> {
  const [event] = (await eventsAfter(seq)).filter((e) => e.action === 'agents.revoke');
  expect(JSON.parse(event?.before_json ?? '{}')).toEqual({
    grants: grants.map((g) => g.grantId).toSorted(),
  });
  expect(event?.after_json).toBeNull();
  for (const grant of grants) expect(await works(grant)).toBe(false);
}

describe('revoking a person revokes their agents', () => {
  it('re-enrolment', async () => {
    const p = await person();
    const seq = await headSeq();
    expect(await works(p.agent)).toBe(true);
    await reenrol(await adminScope(), env.DB, SESSION_SECRET, p.id, T0);
    await revoked(seq, [p.agent, p.second]);
  });

  it('offboarding', async () => {
    const p = await person();
    const seq = await headSeq();
    await offboard(await adminScope(), env.DB, p.id, T0);
    await revoked(seq, [p.agent, p.second]);
  });

  it('sign out everywhere, even with no other session to end', async () => {
    const p = await person();
    const seq = await headSeq();
    const session = await newSession(env.DB, SESSION_SECRET, p.id, T0, DEFAULT_POLICY.sessionMaxMs);
    await session.statement.run();
    const ended = await logoutOthers(
      systemScope(),
      env.DB,
      SESSION_SECRET,
      p.id,
      session.rawId,
      T0,
    );
    expect(ended).toBe(0);
    await revoked(seq, [p.agent, p.second]);
  });

  it('removing a passkey', async () => {
    const p = await person();
    const first = await withPasskey(p.id);
    await withPasskey(p.id);
    const seq = await headSeq();
    await revokeOwnPasskey(systemScope(), env.DB, p.id, first, 'keep', T0);
    await revoked(seq, [p.agent, p.second]);
  });

  it('a person with no agents gets no agents.revoke event, and another person is untouched', async () => {
    const other = await person();
    const bare = await addPerson();
    const seq = await headSeq();
    await reenrol(await adminScope(), env.DB, SESSION_SECRET, bare.id, T0);
    expect((await eventsAfter(seq)).filter((e) => e.action === 'agents.revoke')).toEqual([]);
    expect(await works(other.agent)).toBe(true);
    expect(await liveGrantIdsOf(env.DB, other.id)).toHaveLength(2);
  });
});
