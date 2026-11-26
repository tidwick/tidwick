// What a decision on a week carries and records: the reason a return gives, the fingerprint it was read against,
// and the approval of an offboarded person's open week on their behalf. Each has its refusal beside it.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { offboard, T0 } from '../../test/helpers/auth';
import { bookedWeek, WEEK } from '../../test/helpers/booking';
import { eventsAfter, headSeq } from '../../test/helpers/reference';
import { noteKeks } from '../lib/env';
import { saveCells } from './entry-writes';
import { decideWeek, submitWeek, weekFingerprint } from './submissions';
import { weekDecision } from './week-decision';
import { weekState } from './week-view';

type Week = Awaited<ReturnType<typeof bookedWeek>>;

const stateOf = (w: Week) => weekState(w.admin, env.DB, w.who.personId, WEEK);
const edit = (w: Week, hundredths: number, at: number) =>
  saveCells(
    w.member,
    env.DB,
    noteKeks(),
    WEEK,
    [{ rowId: w.rowId, dow: 1, hundredths, note: '' }],
    at,
  );

describe('a return gives its reason', () => {
  it('is stored, shown with who decided and when, audited, and cleared by a resubmit or an approval', async () => {
    const w = await bookedWeek();
    const seq = await headSeq();
    await submitWeek(w.member, env.DB, WEEK, T0);
    await decideWeek(w.admin, env.DB, w.who.personId, WEEK, 'return', T0 + 7, {
      reason: 'Friday is missing',
    });
    const returned = await weekDecision(w.member, env.DB, w.who.personId, WEEK);
    expect(returned).toMatchObject({ reason: 'Friday is missing', at: T0 + 7 });
    expect(returned.by).toMatch(/^Person /);
    const events = await eventsAfter(seq);
    const last = events.at(-1);
    expect(last?.action).toBe('submission.return');
    expect(JSON.parse(last?.after_json ?? '{}')).toEqual({
      state: 'returned',
      reason: 'Friday is missing',
    });

    await submitWeek(w.member, env.DB, WEEK, T0 + 9);
    expect(await weekDecision(w.member, env.DB, w.who.personId, WEEK)).toMatchObject({
      by: null,
      reason: null,
    });
    await decideWeek(w.admin, env.DB, w.who.personId, WEEK, 'return', T0 + 11, { reason: 'Again' });
    await submitWeek(w.member, env.DB, WEEK, T0 + 12);
    await decideWeek(w.admin, env.DB, w.who.personId, WEEK, 'approve', T0 + 13, {
      reason: 'ignored on an approval',
    });
    const approved = await weekDecision(w.member, env.DB, w.who.personId, WEEK);
    expect(approved).toMatchObject({ reason: null, at: T0 + 13 });
    expect(approved.by).not.toBeNull();
  });

  it('a member cannot read another person’s decision', async () => {
    const w = await bookedWeek();
    const other = await bookedWeek();
    await expect(weekDecision(w.member, env.DB, other.who.personId, WEEK)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('a decision carries the week the approver read', () => {
  it('lands while the week is as read and is a conflict, writing no event, once it has changed', async () => {
    const w = await bookedWeek();
    await submitWeek(w.member, env.DB, WEEK, T0);
    const seen = await weekFingerprint(w.admin, env.DB, w.who.personId, WEEK);
    expect(seen.n).toBe(1);
    expect(seen.total).toBe(400);
    // An edit through the lock lands between the read and the decision.
    await env.DB.exec(
      `UPDATE entry SET hundredths = 900, updated_at = ${String(T0 + 99)} WHERE row_id = '${w.rowId}'`,
    );
    const seq = await headSeq();
    for (const event of ['approve', 'return'] as const) {
      await expect(
        decideWeek(w.admin, env.DB, w.who.personId, WEEK, event, T0 + 100, { unchanged: seen }),
      ).rejects.toMatchObject({ code: 'conflict' });
    }
    expect(await stateOf(w)).toBe('submitted');
    expect(await eventsAfter(seq)).toEqual([]);

    const fresh = await weekFingerprint(w.admin, env.DB, w.who.personId, WEEK);
    expect(fresh.total).toBe(900);
    await decideWeek(w.admin, env.DB, w.who.personId, WEEK, 'approve', T0 + 101, {
      unchanged: fresh,
    });
    expect(await stateOf(w)).toBe('approved');
  });

  it('a submit carries it too: a week edited after the owner confirmed is not submitted', async () => {
    const w = await bookedWeek();
    const seen = await weekFingerprint(w.member, env.DB, w.who.personId, WEEK);
    await edit(w, 250, T0 + 5);
    await expect(submitWeek(w.member, env.DB, WEEK, T0 + 6, seen)).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(await stateOf(w)).toBe('draft');
    const now = await weekFingerprint(w.member, env.DB, w.who.personId, WEEK);
    expect(now).toMatchObject({ n: 2, total: 650 });
    await submitWeek(w.member, env.DB, WEEK, T0 + 7, now);
    expect(await stateOf(w)).toBe('submitted');
  });
});

describe('an approver approves an offboarded person’s open week on their behalf', () => {
  it('turns a draft or a returned week into an approved one, marked in the audit event', async () => {
    const draft = await bookedWeek();
    await offboard(draft.who.personId);
    const seq = await headSeq();
    expect(await decideWeek(draft.admin, env.DB, draft.who.personId, WEEK, 'approve', T0 + 3)).toBe(
      'approved',
    );
    const [event] = await eventsAfter(seq);
    expect(event?.action).toBe('submission.approve');
    expect(event?.actor_id).toBe(draft.admin.actorId);
    expect(JSON.parse(event?.before_json ?? '{}')).toEqual({ state: 'draft' });
    expect(JSON.parse(event?.after_json ?? '{}')).toEqual({ state: 'approved', onBehalf: true });
    expect(await weekDecision(draft.admin, env.DB, draft.who.personId, WEEK)).toMatchObject({
      at: T0 + 3,
    });

    const back = await bookedWeek();
    await submitWeek(back.member, env.DB, WEEK, T0);
    await decideWeek(back.admin, env.DB, back.who.personId, WEEK, 'return', T0 + 1, {
      reason: 'Redo',
    });
    await offboard(back.who.personId);
    expect(await decideWeek(back.admin, env.DB, back.who.personId, WEEK, 'approve', T0 + 2)).toBe(
      'approved',
    );
    expect(await weekDecision(back.admin, env.DB, back.who.personId, WEEK)).toMatchObject({
      reason: null,
    });
  });

  it('refuses a person who is still here, and a draft or returned week cannot be returned', async () => {
    const w = await bookedWeek();
    const seq = await headSeq();
    await expect(
      decideWeek(w.admin, env.DB, w.who.personId, WEEK, 'approve', T0),
    ).rejects.toMatchObject({ code: 'bad_transition' });
    await offboard(w.who.personId);
    await expect(
      decideWeek(w.admin, env.DB, w.who.personId, WEEK, 'return', T0, { reason: 'No' }),
    ).rejects.toMatchObject({ code: 'bad_transition' });
    expect(await stateOf(w)).toBe('draft');
    expect(await eventsAfter(seq)).toEqual([]);
  });

  it('a fingerprint guards it as it guards any decision', async () => {
    const w = await bookedWeek();
    const seen = await weekFingerprint(w.admin, env.DB, w.who.personId, WEEK);
    await edit(w, 100, T0 + 4);
    await offboard(w.who.personId);
    await expect(
      decideWeek(w.admin, env.DB, w.who.personId, WEEK, 'approve', T0 + 5, { unchanged: seen }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await stateOf(w)).toBe('draft');
  });

  it('a member scope never reaches it', async () => {
    const w = await bookedWeek();
    await offboard(w.who.personId);
    await expect(
      decideWeek(w.member, env.DB, w.who.personId, WEEK, 'approve', T0),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
