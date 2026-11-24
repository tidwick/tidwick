// SEC-13 through the built Worker: a submitted week is locked to its owner, an accounting admin edits through the
// lock with every change audited before and after, and approve and return need a fresh passkey confirmation.
import { describe, expect, it } from 'vitest';
import { ACCOUNTING, MINUTE } from '../../test/helpers/auth';
import {
  booking,
  cell,
  hoursOf,
  messageOf,
  save,
  twoRows,
  weekOf,
  WEEK,
  type Booking,
} from '../../test/helpers/booking';
import { caller, rpcForm, type Caller, type Fields } from '../../test/helpers/callers';
import { eventsAfter, headSeq } from '../../test/helpers/reference';

const stale = () => caller([ACCOUNTING], { stepUpAgo: 16 * MINUTE });

const submit = (who: Caller) => rpcForm('submission.submit', who, { weekStart: WEEK });
const decide = (event: 'approve' | 'return', who: Caller, b: Booking) =>
  rpcForm(`submission.${event}`, who, { personId: b.who.personId, weekStart: WEEK });
const editFor = (who: Caller, b: Booking, ...cells: Fields[]) =>
  rpcForm(
    'entriesFor.save',
    who,
    Object.assign({ personId: b.who.personId, weekStart: WEEK }, ...cells) as Fields,
  );

/** A member with hours on Monday of the first row, and the week submitted. */
async function submitted(): Promise<{ b: Booking; row: string }> {
  const b = await booking();
  const [row] = await twoRows(b);
  expect((await save(b.who, WEEK, cell(row, 0, '4'))).status).toBe(200);
  expect((await submit(b.who)).status).toBe(200);
  return { b, row };
}

const parsed = (json: string | null): unknown => (json === null ? null : JSON.parse(json));

describe('SEC-13 a submitted week is locked to its owner', () => {
  it('SEC-13 a submitted week rejects the owner’s edits with 403, where the same edit was accepted before', async () => {
    const b = await booking();
    const [row] = await twoRows(b);
    expect((await save(b.who, WEEK, cell(row, 0, '4'))).status).toBe(200);
    const done = await submit(b.who);
    expect(done.status).toBe(200);
    expect((await weekOf(b.who, WEEK)).state).toBe('submitted');
    const refused = await save(b.who, WEEK, cell(row, 0, '6'));
    expect(refused.status).toBe(403);
    expect(await messageOf(refused)).toMatch(/locked/);
    expect((await hoursOf(b, WEEK))[0]?.[0]).toBe(400);
    expect((await rpcForm('entries.copyLastWeek', b.who, { weekStart: WEEK })).status).toBe(403);
  });

  it('SEC-13 a week cannot be submitted twice, and the refusal writes no event', async () => {
    const { b } = await submitted();
    const seq = await headSeq();
    const again = await submit(b.who);
    expect(again.status).toBe(409);
    expect(await messageOf(again)).toMatch(/not allowed/);
    expect(await eventsAfter(seq)).toEqual([]);
  });

  it('SEC-13 a submit is audited with the state before and after', async () => {
    const b = await booking();
    const seq = await headSeq();
    expect((await submit(b.who)).status).toBe(200);
    const events = await eventsAfter(seq);
    expect(events.map((e) => [e.action, e.actor_id, e.target])).toEqual([
      ['submission.submit', b.who.personId, `week:${b.who.personId}:${WEEK}`],
    ]);
    expect(parsed(events[0]?.before_json ?? null)).toEqual({ state: 'draft' });
    expect(parsed(events[0]?.after_json ?? null)).toEqual({ state: 'submitted' });
  });
});

describe('SEC-13 edits through the lock', () => {
  it('SEC-13 an accounting admin’s edit through the lock is audited with before and after', async () => {
    const { b, row } = await submitted();
    const admin = await caller([ACCOUNTING]);
    const seq = await headSeq();
    const edited = await editFor(admin, b, cell(row, 0, '6'), cell(row, 1, '2', 'site visit'));
    expect(edited.status).toBe(200);
    expect((await weekOf(b.who, WEEK)).state).toBe('submitted');
    expect((await weekOf(b.who, WEEK)).rows[0]?.cells.slice(0, 2)).toEqual([
      { hundredths: 600, note: '' },
      { hundredths: 200, note: 'site visit' },
    ]);
    const events = await eventsAfter(seq);
    expect(events.map((e) => [e.action, e.actor_id, e.client_id])).toEqual([
      ['entriesFor.save', admin.personId, b.clientId],
      ['entriesFor.save', admin.personId, b.clientId],
    ]);
    const changes = events.map((e) => [parsed(e.before_json), parsed(e.after_json)]);
    expect(changes).toContainEqual([
      { hundredths: 400, note_ct: null },
      { hundredths: 600, note_ct: null },
    ]);
    const added = changes.find(([before]) => before === null)?.[1] as {
      hundredths: number;
      note_ct: string;
    };
    expect(added.hundredths).toBe(200);
    expect(added.note_ct).toMatch(/^[0-9a-f]{40,}$/);
    expect(JSON.stringify(events)).not.toContain('site visit');
  });

  it('SEC-13 the owner stays locked out after an edit through the lock, and an unchanged save writes no event', async () => {
    const { b, row } = await submitted();
    const admin = await caller([ACCOUNTING]);
    expect((await editFor(admin, b, cell(row, 0, '5'))).status).toBe(200);
    expect((await save(b.who, WEEK, cell(row, 0, '7'))).status).toBe(403);
    const seq = await headSeq();
    expect((await editFor(admin, b, cell(row, 0, '5'))).status).toBe(200);
    expect(await eventsAfter(seq)).toEqual([]);
  });

  it('SEC-13 a member cannot edit through the lock, nor can an accounting admin without step-up', async () => {
    const { b, row } = await submitted();
    const seq = await headSeq();
    for (const who of [b.who, await caller(), await stale()]) {
      expect((await editFor(who, b, cell(row, 0, '9'))).status).toBe(403);
    }
    expect((await hoursOf(b, WEEK))[0]?.[0]).toBe(400);
    expect(await eventsAfter(seq)).toEqual([]);
  });
});

describe('SEC-13 approve and return need an accounting admin with step-up', () => {
  it('SEC-13 approve without step-up returns 403 and leaves the week submitted with no event', async () => {
    const { b } = await submitted();
    const seq = await headSeq();
    const refused = await decide('approve', await stale(), b);
    expect(refused.status).toBe(403);
    expect((await refused.json<{ error: string }>()).error).toBe('step_up_required');
    expect((await decide('approve', b.who, b)).status).toBe(403);
    expect((await weekOf(b.who, WEEK)).state).toBe('submitted');
    expect(await eventsAfter(seq)).toEqual([]);

    const admin = await caller([ACCOUNTING]);
    expect((await decide('approve', admin, b)).status).toBe(200);
    expect((await weekOf(b.who, WEEK)).state).toBe('approved');
    const events = await eventsAfter(seq);
    expect(events.map((e) => [e.action, e.actor_id])).toEqual([
      ['submission.approve', admin.personId],
    ]);
  });

  it('SEC-13 return without step-up is refused; with it the owner may edit and submit again', async () => {
    const { b, row } = await submitted();
    expect((await decide('return', await stale(), b)).status).toBe(403);
    const admin = await caller([ACCOUNTING]);
    expect((await decide('approve', admin, b)).status).toBe(200);
    expect((await decide('return', admin, b)).status).toBe(200);
    expect((await weekOf(b.who, WEEK)).state).toBe('returned');
    expect((await save(b.who, WEEK, cell(row, 0, '3'))).status).toBe(200);
    expect((await submit(b.who)).status).toBe(200);
    expect((await weekOf(b.who, WEEK)).state).toBe('submitted');
  });

  it('SEC-13 a draft cannot be approved, and an approved week cannot be approved again', async () => {
    const b = await booking();
    const admin = await caller([ACCOUNTING]);
    expect((await decide('approve', admin, b)).status).toBe(409);
    expect((await submit(b.who)).status).toBe(200);
    expect((await decide('approve', admin, b)).status).toBe(200);
    const again = await decide('approve', admin, b);
    expect(again.status).toBe(409);
    expect(await messageOf(again)).toMatch(/not allowed/);
  });
});
