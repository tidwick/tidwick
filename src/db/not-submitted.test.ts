// Who is chased for a completed week, and who is not: each rule that leaves a person out has a case of its own.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { adminScope, offboard, T0 } from '../../test/helpers/auth';
import { bookedWeek, WEEK } from '../../test/helpers/booking';
import { caller } from '../../test/helpers/callers';
import { personById } from './people';
import { notSubmittedWeeks, type EndedWeek } from './not-submitted';
import { recentWeeks } from './my-weeks';
import { decideWeek, submitWeek } from './submissions';

// The booked week, WEEK, ends a week after it starts; a person assigned at T0 (inside that week) was on the books.
const AFTER: EndedWeek = { weekStart: WEEK, endsAt: Date.UTC(2026, 0, 12) };
const EARLIER: EndedWeek = { weekStart: '2025-12-22', endsAt: Date.UTC(2025, 11, 29) };
const LATER: EndedWeek = { weekStart: '2026-01-12', endsAt: Date.UTC(2026, 0, 19) };

async function missing(person: string, ...ended: EndedWeek[]) {
  const { weeks } = await notSubmittedWeeks(await adminScope(), env.DB, ended);
  return weeks.filter((w) => w.person_id === person).map((w) => `${w.week_start} ${w.state}`);
}

describe('the weeks nobody has submitted', () => {
  it('lists a person on the books for a week with no submission, and a week that was returned', async () => {
    const w = await bookedWeek();
    expect(await missing(w.who.personId, AFTER, LATER)).toEqual([
      `${WEEK} draft`,
      '2026-01-12 draft',
    ]);
    await submitWeek(w.member, env.DB, WEEK, T0);
    await decideWeek(w.admin, env.DB, w.who.personId, WEEK, 'return', T0 + 1, { reason: 'Redo' });
    expect(await missing(w.who.personId, AFTER)).toEqual([`${WEEK} returned`]);
  });

  it('leaves out a week that is submitted or approved', async () => {
    const w = await bookedWeek();
    await submitWeek(w.member, env.DB, WEEK, T0);
    expect(await missing(w.who.personId, AFTER)).toEqual([]);
    await decideWeek(w.admin, env.DB, w.who.personId, WEEK, 'approve', T0 + 1);
    expect(await missing(w.who.personId, AFTER)).toEqual([]);
  });

  it('leaves out a person who is offboarded', async () => {
    const w = await bookedWeek();
    expect(await missing(w.who.personId, AFTER)).toHaveLength(1);
    await offboard(w.who.personId);
    expect(await missing(w.who.personId, AFTER)).toEqual([]);
  });

  it('leaves out a person created after the week ended', async () => {
    const w = await bookedWeek();
    await env.DB.exec(
      `UPDATE person SET created_at = ${String(AFTER.endsAt + 1)} WHERE id = '${w.who.personId}'`,
    );
    expect(await missing(w.who.personId, AFTER)).toEqual([]);
    expect(await missing(w.who.personId, LATER)).toEqual(['2026-01-12 draft']);
  });

  it('leaves out a person whose first assignment came after the week ended, or who has none', async () => {
    const w = await bookedWeek();
    expect(await missing(w.who.personId, EARLIER)).toEqual([]);
    expect(await missing(w.who.personId, EARLIER, AFTER)).toEqual([`${WEEK} draft`]);
    const unassigned = await caller();
    expect(await missing(unassigned.personId, AFTER, LATER)).toEqual([]);
    await env.DB.exec(`DELETE FROM assignment WHERE person_id = '${w.who.personId}'`);
    expect(await missing(w.who.personId, AFTER)).toEqual([]);
  });

  it('keeps people in name order with their weeks oldest first, and is for an all-clients scope only', async () => {
    const w = await bookedWeek();
    const { weeks } = await notSubmittedWeeks(w.admin, env.DB, [LATER, AFTER]);
    const mine = weeks.filter((x) => x.person_id === w.who.personId).map((x) => x.week_start);
    expect(mine).toEqual([WEEK, '2026-01-12']);
    await expect(notSubmittedWeeks(w.member, env.DB, [AFTER])).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('a search term keeps the people it matches', async () => {
    const w = await bookedWeek();
    const other = await bookedWeek();
    const email = (await personById(env.DB, w.who.personId))?.email ?? '';
    const found = await notSubmittedWeeks(w.admin, env.DB, [AFTER], email);
    expect(found.weeks.map((x) => x.person_id)).toEqual([w.who.personId]);
    expect(found.weeks.some((x) => x.person_id === other.who.personId)).toBe(false);
    expect((await notSubmittedWeeks(w.admin, env.DB, [AFTER], '%')).weeks).toEqual([]);
  });
});

describe('my weeks', () => {
  it('shows each week’s state and hours, returned first, then newest first', async () => {
    const w = await bookedWeek();
    await submitWeek(w.member, env.DB, WEEK, T0);
    await decideWeek(w.admin, env.DB, w.who.personId, WEEK, 'return', T0 + 1, { reason: 'Redo' });
    const weeks = await recentWeeks(w.member, env.DB, w.who.personId, [
      '2026-01-19',
      '2026-01-12',
      WEEK,
    ]);
    expect(weeks).toEqual([
      { weekStart: WEEK, state: 'returned', total: 400 },
      { weekStart: '2026-01-19', state: 'draft', total: 0 },
      { weekStart: '2026-01-12', state: 'draft', total: 0 },
    ]);
    const other = await bookedWeek();
    await expect(recentWeeks(w.member, env.DB, other.who.personId, [WEEK])).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
