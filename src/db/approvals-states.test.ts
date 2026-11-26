// The approvals list reaches every state, inside a range of weeks, and says when it was cut at a page.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { offboard, T0 } from '../../test/helpers/auth';
import { bookedWeek, WEEK } from '../../test/helpers/booking';
import { approvalWeeks, nextWaiting, type ListedState } from './approvals';
import { decideWeek, submitWeek } from './submissions';
import { DEFAULT_POLICY } from '../lib/policy';

async function listed(
  b: Awaited<ReturnType<typeof bookedWeek>>,
  state: ListedState,
  range: { from?: string; to?: string } = {},
) {
  const { weeks } = await approvalWeeks(
    b.admin,
    env.DB,
    { state, ...range },
    DEFAULT_POLICY.approvalsPage,
  );
  return weeks.filter((w) => w.person_id === b.who.personId);
}

describe('the approvals list by state', () => {
  it('a week appears under exactly the state it is in, with the hours it holds', async () => {
    const w = await bookedWeek();
    const states: ListedState[] = ['submitted', 'approved', 'returned', 'draft'];
    const where = async () => {
      const found: ListedState[] = [];
      for (const state of states) if ((await listed(w, state)).length > 0) found.push(state);
      return found;
    };
    expect(await where()).toEqual(['draft']);
    expect((await listed(w, 'draft'))[0]).toMatchObject({ week_start: WEEK, total: 400, at: null });
    await submitWeek(w.member, env.DB, WEEK, T0);
    expect(await where()).toEqual(['submitted']);
    await decideWeek(w.admin, env.DB, w.who.personId, WEEK, 'approve', T0 + 5);
    expect(await where()).toEqual(['approved']);
    expect((await listed(w, 'approved'))[0]?.at).toBe(T0 + 5);
    await decideWeek(w.admin, env.DB, w.who.personId, WEEK, 'return', T0 + 9);
    expect(await where()).toEqual(['returned']);
    expect((await listed(w, 'returned'))[0]?.at).toBe(T0 + 9);
  });

  it('a range keeps the weeks inside it, both ends included', async () => {
    const w = await bookedWeek();
    await submitWeek(w.member, env.DB, WEEK, T0);
    expect(await listed(w, 'submitted', { from: WEEK, to: WEEK })).toHaveLength(1);
    expect(await listed(w, 'submitted', { from: '2026-01-12' })).toHaveLength(0);
    expect(await listed(w, 'submitted', { to: '2025-12-29' })).toHaveLength(0);
    expect(await listed(w, 'submitted', { from: '2025-12-29', to: '2026-01-12' })).toHaveLength(1);
  });

  it('marks a person who has left, so an approver sees why only they can decide', async () => {
    const w = await bookedWeek();
    expect((await listed(w, 'draft'))[0]?.offboarded).toBe(0);
    await offboard(w.who.personId);
    expect((await listed(w, 'draft'))[0]?.offboarded).toBe(1);
  });

  it('a member scope cannot read any state', async () => {
    const w = await bookedWeek();
    for (const state of ['submitted', 'approved', 'returned', 'draft'] as const) {
      await expect(
        approvalWeeks(w.member, env.DB, { state }, DEFAULT_POLICY.approvalsPage),
      ).rejects.toMatchObject({
        code: 'not_found',
      });
    }
  });
});

describe('a list past its page says how many there are', () => {
  it('holds a page and reports the full count; a list under a page reports its own length', async () => {
    const w = await bookedWeek();
    const extra = DEFAULT_POLICY.approvalsPage + 1;
    const rows = `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${String(extra)}) INSERT INTO week_submission (person_id, week_start, state, submitted_at) SELECT '${w.who.personId}', date('2000-01-03', '+' || (i * 7) || ' days'), 'approved', 1 FROM n;`;
    await env.DB.exec(rows);
    const from = '2000-01-03';
    const cut = await approvalWeeks(
      w.admin,
      env.DB,
      { state: 'approved', from },
      DEFAULT_POLICY.approvalsPage,
    );
    expect(cut.weeks).toHaveLength(DEFAULT_POLICY.approvalsPage);
    expect(cut.found).toBeGreaterThanOrEqual(extra);
    const small = await approvalWeeks(
      w.admin,
      env.DB,
      {
        state: 'approved',
        from,
        to: '2000-03-27',
      },
      DEFAULT_POLICY.approvalsPage,
    );
    expect(small.weeks.filter((x) => x.person_id === w.who.personId)).toHaveLength(12);
    expect(small.found).toBe(small.weeks.length);
  });
});

describe('the next week waiting', () => {
  it('is the first submitted week after this one in list order, and null when none follows', async () => {
    const w = await bookedWeek();
    await submitWeek(w.member, env.DB, WEEK, T0);
    const next = await nextWaiting(w.admin, env.DB, w.who.personId, WEEK);
    expect(next === null || next.person_id !== w.who.personId || next.week_start > WEEK).toBe(true);
    const tail = await nextWaiting(w.admin, env.DB, w.who.personId, '2999-12-27');
    expect(tail === null || tail.person_id !== w.who.personId).toBe(true);
    await expect(nextWaiting(w.member, env.DB, w.who.personId, WEEK)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
