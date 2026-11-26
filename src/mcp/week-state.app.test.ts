// What get_week tells an agent beyond the cells (state, fingerprint, the reason a week came back), and what an agent
// scope can never do: decide a week, on behalf of its owner or anyone else.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { agentScope, cells, setup, tool } from '../../test/helpers/agent';
import { adminScope, T0 } from '../../test/helpers/auth';
import { WEEK, weekOf } from '../../test/helpers/booking';
import { eventsAfter, headSeq } from '../../test/helpers/reference';
import { offboard } from '../auth/offboard';
import { decideWeek } from '../db/submissions';
import { dropAssignments, setReturnReasons } from '../db/test-support-agents';
import { REASON_SHOWN } from './cells';

async function submitted() {
  const s = await setup();
  await tool(s.agent, 'save_entries', { weekStart: WEEK, cells: cells(s.rowId, [0, 8]) });
  const first = await tool(s.agent, 'submit_week', { weekStart: WEEK });
  await tool(s.agent, 'submit_week', { weekStart: WEEK, confirm: first.data.confirm });
  return s;
}

describe('get_week state and fingerprint', () => {
  it('carries the week state and a fingerprint that moves with an edit and matches what a person sees', async () => {
    const { b, agent, rowId } = await setup();
    const before = await tool(agent, 'get_week', { weekStart: WEEK });
    expect(before.data).toMatchObject({
      state: 'draft',
      fingerprint: (await weekOf(b.who, WEEK)).fingerprint,
    });
    await tool(agent, 'save_entries', { weekStart: WEEK, cells: cells(rowId, [0, 3]) });
    const after = await tool(agent, 'get_week', { weekStart: WEEK });
    expect(after.data.fingerprint).not.toBe(before.data.fingerprint);
    expect(after.data.fingerprint).toBe((await weekOf(b.who, WEEK)).fingerprint);
    expect(after.data).not.toHaveProperty('returnReason');
  });
});

describe('rows on a project the person no longer has', () => {
  it('stay in the agent’s view of its own week, so its totals match the person’s', async () => {
    const { b, agent, rowId } = await setup();
    await tool(agent, 'save_entries', { weekStart: WEEK, cells: cells(rowId, [0, 5]) });
    await dropAssignments(env.DB, b.who.personId);
    const seen = await tool(agent, 'get_week', { weekStart: WEEK });
    const rows = seen.data.rows as { rowId: string; cells: { hundredths: number }[] }[];
    expect(rows.map((r) => r.rowId)).toEqual([rowId]);
    expect(rows[0]?.cells[0]?.hundredths).toBe(500);
  });
});

describe('a returned week', () => {
  it('shows the reason, capped, and never who returned it, and resubmits under a fresh confirm', async () => {
    const { b, agent } = await submitted();
    const admin = await adminScope();
    await decideWeek(admin, env.DB, b.who.personId, WEEK, 'return', T0, {
      reason: 'Day 1 is short',
    });
    const returned = await tool(agent, 'get_week', { weekStart: WEEK });
    expect(returned.data).toMatchObject({ state: 'returned', returnReason: 'Day 1 is short' });
    expect(returned.text).not.toMatch(/"(by|decidedBy|decided_by|approver)"/);

    await setReturnReasons(env.DB, b.who.personId, 'r'.repeat(900));
    const long = await tool(agent, 'get_week', { weekStart: WEEK });
    expect(String(long.data.returnReason)).toHaveLength(REASON_SHOWN);

    const first = await tool(agent, 'submit_week', { weekStart: WEEK });
    const again = await tool(agent, 'submit_week', {
      weekStart: WEEK,
      confirm: first.data.confirm,
    });
    expect(again.data).toMatchObject({ submitted: true, state: 'submitted' });
    expect((await tool(agent, 'get_week', { weekStart: WEEK })).data).not.toHaveProperty(
      'returnReason',
    );
  });

  it('a stale confirm is refused and names get_week as the next step', async () => {
    const { b, agent, rowId } = await setup();
    await tool(agent, 'save_entries', { weekStart: WEEK, cells: cells(rowId, [0, 8]) });
    const first = await tool(agent, 'submit_week', { weekStart: WEEK });
    await tool(agent, 'save_entries', { weekStart: WEEK, cells: cells(rowId, [1, 2]) });
    const stale = await tool(agent, 'submit_week', {
      weekStart: WEEK,
      confirm: first.data.confirm,
    });
    expect(stale).toMatchObject({ isError: true, data: { error: 'conflict' } });
    expect(String(stale.data.message)).toContain('get_week');
    expect((await weekOf(b.who, WEEK)).state).toBe('draft');
  });
});

describe('an agent never decides a week', () => {
  it('SEC-62 an agent scope is refused by decideWeek, approving or returning (negative case: an admin scope passes)', async () => {
    const { b, agent } = await submitted();
    const scope = await agentScope(agent);
    for (const event of ['approve', 'return'] as const) {
      await expect(
        decideWeek(scope, env.DB, b.who.personId, WEEK, event, T0),
      ).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
    expect((await weekOf(b.who, WEEK)).state).toBe('submitted');
    await decideWeek(await adminScope(), env.DB, b.who.personId, WEEK, 'approve', T0);
    expect((await weekOf(b.who, WEEK)).state).toBe('approved');
  });

  it('SEC-62 an on-behalf approval of an offboarded person is the admin’s event and carries no agent marker', async () => {
    const { b } = await submitted();
    const admin = await adminScope();
    await offboard(admin, env.DB, b.who.personId, T0);
    const seq = await headSeq();
    await decideWeek(admin, env.DB, b.who.personId, WEEK, 'approve', T0 + 1);
    const approvals = (await eventsAfter(seq)).filter((e) => e.action === 'submission.approve');
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.after_json).not.toContain('via');
    expect(approvals[0]?.actor_id).not.toBe(b.who.personId);
  });
});
