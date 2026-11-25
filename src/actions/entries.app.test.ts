// The week grid's Actions through the built Worker by the script caller: the rules the island and the no-script
// form both rely on are enforced on the server, so a client that skips its own checks changes nothing.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import {
  addRow,
  booking,
  cell,
  hoursOf,
  messageOf,
  project,
  save,
  twoRows,
  weekOf,
  WEEK,
  NEXT,
} from '../../test/helpers/booking';
import { adminScope } from '../../test/helpers/auth';
import { caller, rpcForm } from '../../test/helpers/callers';
import { removeAssignment } from '../db/assignments';
import { GRANTS } from '../db/roles';
import { storedRows } from '../db/stored-rows';
import { rowTotal } from '../lib/week';

describe('entries.save enforces the day cap on the server', () => {
  it('a day holds at most 24 hours: 24 is accepted and one hundredth more is rejected with nothing written', async () => {
    const b = await booking();
    const [row] = await twoRows(b);
    expect((await save(b.who, WEEK, cell(row, 0, '24'))).status).toBe(200);
    expect((await hoursOf(b, WEEK))[0]?.[0]).toBe(2400);
    const over = await save(b.who, WEEK, cell(row, 0, '24.01'));
    expect(over.status).toBe(400);
    expect((await hoursOf(b, WEEK))[0]?.[0]).toBe(2400);
  });

  it('the 24 hour cap counts every row of the day, so two rows of 16 and 9 hours are refused as a whole', async () => {
    const b = await booking();
    const [a, c] = await twoRows(b);
    expect((await save(b.who, WEEK, cell(a, 2, '16'))).status).toBe(200);
    const response = await save(b.who, WEEK, cell(c, 2, '9'), cell(a, 3, '1'));
    expect(response.status).toBe(400);
    expect(await messageOf(response)).toMatch(/24 hours/);
    expect(await hoursOf(b, WEEK)).toEqual([
      [0, 0, 1600, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
    ]);
    expect((await save(b.who, WEEK, cell(c, 2, '8'))).status).toBe(200);
  });

  it('moving hours between rows on a full day works, whatever order the cells arrive in', async () => {
    const b = await booking();
    const [a, c] = await twoRows(b);
    expect((await save(b.who, WEEK, cell(a, 1, '24'))).status).toBe(200);
    const moved = await save(b.who, WEEK, cell(c, 1, '10'), cell(a, 1, '14'));
    expect(moved.status).toBe(200);
    expect(await hoursOf(b, WEEK)).toEqual([
      [0, 1400, 0, 0, 0, 0, 0],
      [0, 1000, 0, 0, 0, 0, 0],
    ]);
  });

  it('future dates are accepted', async () => {
    const b = await booking();
    for (const week of ['2031-03-03', '2099-12-28']) {
      const row = await addRow(b.who, week, b.projectId, b.tasks[0] ?? { id: '', code: '' });
      expect((await save(b.who, week, cell(row, 6, '3.5'))).status, week).toBe(200);
      expect((await hoursOf(b, week))[0]?.[6], week).toBe(350);
    }
  });
});

describe('entries.removeRow and copyLastWeek', () => {
  it('a row can be removed only when every cell is blank or zero with no note', async () => {
    const b = await booking();
    const [a, c] = await twoRows(b);
    await save(b.who, WEEK, cell(a, 0, '2'), cell(c, 3, '0', 'a note on zero hours'));
    for (const row of [a, c]) {
      const refused = await rpcForm('entries.removeRow', b.who, {
        weekStart: WEEK,
        rowId: row,
      });
      expect(refused.status).toBe(409);
    }
    expect((await weekOf(b.who, WEEK)).rows).toHaveLength(2);
    await save(b.who, WEEK, cell(a, 0, '0'), cell(c, 3, '', ''));
    for (const row of [a, c]) {
      const removed = await rpcForm('entries.removeRow', b.who, {
        weekStart: WEEK,
        rowId: row,
      });
      expect(removed.status).toBe(200);
    }
    expect((await weekOf(b.who, WEEK)).rows).toEqual([]);
  });

  it('copy last week copies rows and no hours or notes', async () => {
    const b = await booking();
    const [a, c] = await twoRows(b, WEEK);
    await save(b.who, WEEK, cell(a, 0, '6', 'drawn up'), cell(c, 4, '1.25'));
    expect((await rpcForm('entries.copyLastWeek', b.who, { weekStart: NEXT })).status).toBe(200);
    const copied = (await weekOf(b.who, NEXT)).rows;
    expect(copied.map((r) => r.taskCode)).toEqual(b.tasks.map((t) => t.code));
    expect(
      copied.every((r) => rowTotal(r.cells) === 0 && r.cells.every((x) => x.note === '')),
    ).toBe(true);
    expect(copied.every((r) => r.removable)).toBe(true);
    expect((await hoursOf(b, WEEK))[0]?.[0]).toBe(600);
  });
});

describe('SEC-12 a member cannot write against a project they are not assigned to', () => {
  it('SEC-12 adding a row on an unassigned project gets 403 and adds nothing', async () => {
    const b = await booking();
    const stranger = await project(b.admin, b.who, 1, false);
    const response = await rpcForm('entries.addRow', b.who, {
      weekStart: WEEK,
      projectId: stranger.projectId,
      taskCodeId: stranger.tasks[0]?.id ?? '',
    });
    expect(response.status).toBe(403);
    expect((await weekOf(b.who, WEEK)).rows).toEqual([]);
  });

  it('SEC-12 saving against a row whose project is no longer assigned gets 403 and writes nothing', async () => {
    const b = await booking();
    const [row] = await twoRows(b);
    await removeAssignment(b.admin, env.DB, b.projectId, b.who.personId, 1);
    const response = await save(b.who, WEEK, cell(row, 0, '5'));
    expect(response.status).toBe(403);
    expect((await storedRows(env.DB, 'entry')).filter((e) => e.row_id === row)).toEqual([]);
  });

  it('SEC-12 an accounting admin or admin saving to their own row on a project no longer assigned gets 403 and writes nothing', async () => {
    const admin = await adminScope();
    for (const grant of GRANTS) {
      const who = await caller([grant]);
      const p = await project(admin, who, 2);
      const kept = await addRow(who, WEEK, p.projectId, p.tasks[0] ?? { id: '', code: '' });
      const fresh = await addRow(who, WEEK, p.projectId, p.tasks[1] ?? { id: '', code: '' });
      expect((await save(who, WEEK, cell(kept, 0, '2'))).status, grant).toBe(200);
      await removeAssignment(admin, env.DB, p.projectId, who.personId, 1);
      for (const edit of [cell(fresh, 0, '5'), cell(kept, 0, '5'), cell(kept, 0, '0')]) {
        expect((await save(who, WEEK, edit)).status, grant).toBe(403);
      }
      const stored = (await storedRows(env.DB, 'entry')).filter(
        (e) => e['row_id'] === kept || e['row_id'] === fresh,
      );
      expect(
        stored.map((e) => [e['row_id'], e['hundredths']]),
        grant,
      ).toEqual([[kept, 200]]);
    }
  });

  it("SEC-12 saving or removing another person's row gets 403 and changes nothing", async () => {
    const mine = await booking();
    const theirs = await booking();
    const [theirRow] = await twoRows(theirs);
    expect((await save(mine.who, WEEK, cell(theirRow, 0, '5'))).status).toBe(403);
    const removal = await rpcForm('entries.removeRow', mine.who, {
      weekStart: WEEK,
      rowId: theirRow,
    });
    expect(removal.status).toBe(403);
    expect((await weekOf(theirs.who, WEEK)).rows).toHaveLength(2);
    expect((await hoursOf(theirs, WEEK))[0]?.[0]).toBe(0);
  });

  it('SEC-12 a signed-out call and a call without the token are refused before the Action runs', async () => {
    const b = await booking();
    expect((await rpcForm('entries.save', null, { weekStart: WEEK })).status).toBe(401);
    const tokenless = { ...b.who, token: 'wrong' };
    expect((await rpcForm('entries.save', tokenless, { weekStart: WEEK })).status).toBe(403);
  });
});
