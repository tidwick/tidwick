// The approvals list: only submitted weeks, each with its total checked against an independent sum of what was saved.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { T0 } from '../../test/helpers/auth';
import { bookedWeek, WEEK } from '../../test/helpers/booking';
import { noteKeks } from '../lib/env';
import { approvalWeeks } from './approvals';
import { saveCells } from './entry-writes';
import { decideWeek, submitWeek } from './submissions';

describe('the approvals list', () => {
  it('lists each submitted week by person with its total hours, and no draft or approved week', async () => {
    const submitted = await bookedWeek();
    const more = [
      { rowId: submitted.rowId, dow: 2, hundredths: 725, note: '' },
      { rowId: submitted.rowId, dow: 4, hundredths: 1, note: 'one hundredth' },
    ];
    await saveCells(submitted.member, env.DB, noteKeks(), WEEK, more, T0);
    await submitWeek(submitted.member, env.DB, WEEK, T0);
    const draft = await bookedWeek();
    const approved = await bookedWeek();
    await submitWeek(approved.member, env.DB, WEEK, T0);
    await decideWeek(approved.admin, env.DB, approved.who.personId, WEEK, 'approve', T0);

    const listed = (await approvalWeeks(submitted.admin, env.DB, { state: 'submitted' })).weeks;
    const ids = listed.map((w) => w.person_id);
    expect(ids).toContain(submitted.who.personId);
    expect(ids).not.toContain(draft.who.personId);
    expect(ids).not.toContain(approved.who.personId);
    const row = listed.find((w) => w.person_id === submitted.who.personId);
    expect(row?.week_start).toBe(WEEK);
    expect(row?.total).toBe(400 + 725 + 1);
  });

  it('a member scope cannot read the list', async () => {
    const w = await bookedWeek();
    await expect(approvalWeeks(w.member, env.DB, { state: 'submitted' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
