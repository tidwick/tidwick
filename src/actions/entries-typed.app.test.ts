// The no-script grid posts every typed cell with whichever button was pressed. Submit, Copy last week and Remove
// save those cells first, a refused save stops the button's own work, and the page shows a refused post's input again.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import {
  addRow,
  booking,
  cell,
  hoursOf,
  messageOf,
  twoRows,
  weekOf,
  WEEK,
  NEXT,
} from '../../test/helpers/booking';
import { formPost, rpcForm } from '../../test/helpers/callers';
import { removeAssignment } from '../db/assignments';
import { weekTotal } from '../lib/week';

describe('a button beside the grid saves the cells typed with it', () => {
  it('Submit week saves the typed hours, then submits the week with them', async () => {
    const b = await booking();
    const [a] = await twoRows(b);
    const seen = (await weekOf(b.who, WEEK)).fingerprint;
    const response = await rpcForm('submission.submit', b.who, {
      weekStart: WEEK,
      fingerprint: seen,
      ...cell(a, 0, '6.5', 'plans'),
    });
    expect(response.status).toBe(200);
    const week = await weekOf(b.who, WEEK);
    expect(week.state).toBe('submitted');
    expect(week.rows[0]?.cells[0]).toEqual({ hundredths: 650, note: 'plans' });
  });

  it('Submit week with a refused cell submits nothing and saves nothing', async () => {
    const b = await booking();
    const [a, c] = await twoRows(b);
    const response = await rpcForm('submission.submit', b.who, {
      weekStart: WEEK,
      ...cell(a, 0, '5'),
      ...cell(c, 1, 'abc'),
    });
    expect(response.status).toBe(400);
    expect((await weekOf(b.who, WEEK)).state).toBe('draft');
    expect(await hoursOf(b, WEEK)).toEqual([new Array(7).fill(0), new Array(7).fill(0)]);
  });

  it('Submit week is a conflict when the week moved after the form was drawn, and the typed cells are not saved', async () => {
    const b = await booking();
    const [a] = await twoRows(b);
    expect(
      (await rpcForm('entries.save', b.who, { weekStart: WEEK, ...cell(a, 0, '1') })).status,
    ).toBe(200);
    const response = await rpcForm('submission.submit', b.who, {
      weekStart: WEEK,
      fingerprint: '0.0.0',
      ...cell(a, 1, '2'),
    });
    expect(response.status).toBe(409);
    expect((await hoursOf(b, WEEK))[0]).toEqual([100, 0, 0, 0, 0, 0, 0]);
  });

  it('Copy last week saves the typed hours as well as copying', async () => {
    const b = await booking();
    const [first] = b.tasks;
    await addRow(b.who, WEEK, b.projectId, first ?? { id: '', code: '' });
    const [row] = await twoRows(b, NEXT);
    const response = await rpcForm('entries.copyLastWeek', b.who, {
      weekStart: NEXT,
      ...cell(row, 2, '3'),
    });
    expect(response.status).toBe(200);
    expect((await hoursOf(b, NEXT))[0]?.[2]).toBe(300);
  });

  it('Remove saves the other typed cells and removes the blank row', async () => {
    const b = await booking();
    const [a, c] = await twoRows(b);
    const response = await rpcForm('entries.removeRow', b.who, {
      weekStart: WEEK,
      rowId: c,
      ...cell(a, 0, '4'),
    });
    expect(response.status).toBe(200);
    const rows = (await weekOf(b.who, WEEK)).rows;
    expect(rows.map((r) => r.rowId)).toEqual([a]);
    expect(rows[0]?.cells[0]?.hundredths).toBe(400);
  });

  it('a refused cell stops Remove, and the message names the day', async () => {
    const b = await booking();
    const [a, c] = await twoRows(b);
    const response = await rpcForm('entries.removeRow', b.who, {
      weekStart: WEEK,
      rowId: c,
      ...cell(a, 3, '30'),
    });
    expect(response.status).toBe(400);
    expect(await messageOf(response)).toMatch(/Thursday/);
    expect((await weekOf(b.who, WEEK)).rows).toHaveLength(2);
  });
});

describe('a refused no-script save keeps what was typed', () => {
  it('the page shows the typed hours and note again beside the message', async () => {
    const b = await booking();
    const [a, c] = await twoRows(b);
    const response = await formPost(`/week/${WEEK}`, 'entries.save', b.who, {
      weekStart: WEEK,
      ...cell(a, 0, '7', 'typed note'),
      ...cell(c, 1, 'abc'),
    });
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toMatch(/Tuesday: enter hours as a number/);
    expect(html).toMatch(
      /name="cell\.[\w-]+\.0\.hours"[^>]*value="7"|value="7"[^>]*name="cell\.[\w-]+\.0\.hours"/,
    );
    expect(html).toContain('typed note');
    expect(html).toMatch(/value="abc"/);
    expect(await hoursOf(b, WEEK)).toEqual([new Array(7).fill(0), new Array(7).fill(0)]);
  });
});

describe('hours on a project the person no longer has', () => {
  it('stay in the member’s week as a read-only row that still counts, and a blank one can be removed', async () => {
    const b = await booking();
    const [a, c] = await twoRows(b);
    expect(
      (await rpcForm('entries.save', b.who, { weekStart: WEEK, ...cell(a, 0, '2') })).status,
    ).toBe(200);
    await removeAssignment(b.admin, env.DB, b.projectId, b.who.personId, 1);
    const week = await weekOf(b.who, WEEK);
    expect(week.rows.map((r) => [r.assigned, r.removable])).toEqual([
      [false, false],
      [false, true],
    ]);
    expect(weekTotal(week.rows)).toBe(200);
    const refused = await rpcForm('entries.save', b.who, { weekStart: WEEK, ...cell(a, 0, '3') });
    expect(refused.status).toBe(403);
    expect((await rpcForm('entries.removeRow', b.who, { weekStart: WEEK, rowId: c })).status).toBe(
      200,
    );
    expect((await weekOf(b.who, WEEK)).rows).toHaveLength(1);
  });
});
