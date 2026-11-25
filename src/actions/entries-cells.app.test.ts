// The week grid's Actions through the built Worker by the script caller: the rules the island and the no-script
// form both rely on are enforced on the server, so a client that skips its own checks changes nothing.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import {
  booking,
  cell,
  hoursOf,
  messageOf,
  save,
  twoRows,
  weekOf,
  WEEK,
} from '../../test/helpers/booking';
import { rpcForm, rpcMultipart } from '../../test/helpers/callers';
import { storedRows } from '../db/stored-rows';
import { dayTotals, rowTotal, weekTotal } from '../lib/week';

describe('entries.save validates and stores cells', () => {
  it('a malformed number, a negative one, over 24 in one cell and a note over 2,000 characters name the day and write nothing', async () => {
    const b = await booking();
    const [row] = await twoRows(b);
    const id = row;
    for (const [fields, text] of [
      [cell(id, 1, 'abc'), /Tuesday/],
      [cell(id, 2, '-3'), /Wednesday/],
      [cell(id, 3, '25'), /Thursday/],
      [cell(id, 4, '1', 'x'.repeat(2001)), /Friday/],
    ] as const) {
      const response = await save(b.who, WEEK, fields);
      expect(response.status).toBe(400);
      expect(JSON.stringify(await response.json())).toMatch(text);
    }
    expect(await hoursOf(b, WEEK)).toEqual([
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
    ]);
  });

  it('hours with more than two decimals round half up to hundredths', async () => {
    const b = await booking();
    const [row] = await twoRows(b);
    expect((await save(b.who, WEEK, cell(row, 0, '7.256'), cell(row, 1, '1.004'))).status).toBe(
      200,
    );
    expect((await hoursOf(b, WEEK))[0]?.slice(0, 2)).toEqual([726, 100]);
  });

  it('a week start that is not a Monday is refused', async () => {
    const b = await booking();
    expect((await rpcForm('entries.save', b.who, { weekStart: '2026-01-06' })).status).toBe(400);
    expect(
      (
        await rpcForm('entries.addRow', b.who, {
          weekStart: 'garbage',
          projectId: b.projectId,
          taskCodeId: b.tasks[0]?.id ?? '',
        })
      ).status,
    ).toBe(400);
  });
});

describe('entries.save cells and notes', () => {
  it('zero hours with no note removes the entry, and a zero cell with a note keeps it', async () => {
    const b = await booking();
    const [row] = await twoRows(b);
    const id = row;
    await save(b.who, WEEK, cell(id, 0, '4'), cell(id, 1, '2'));
    await save(b.who, WEEK, cell(id, 0, '0'), cell(id, 1, '0', 'kept'));
    const stored = (await storedRows(env.DB, 'entry')).filter((e) => e.row_id === id);
    expect(stored.map((e) => e.dow)).toEqual([1]);
    expect((await weekOf(b.who, WEEK)).rows[0]?.cells[1]).toEqual({ hundredths: 0, note: 'kept' });
  });

  it('a note is stored sealed and comes back as the text that was saved, markup and all', async () => {
    const b = await booking();
    const [row] = await twoRows(b);
    const text = 'site visit <b>second</b> floor & "stairs"';
    expect((await save(b.who, WEEK, cell(row, 4, '1.5', text))).status).toBe(200);
    expect((await weekOf(b.who, WEEK)).rows[0]?.cells[4]).toEqual({ hundredths: 150, note: text });
    const stored = (await storedRows(env.DB, 'entry')).find((e) => e.row_id === row);
    expect(stored?.note_ct).toBeTruthy();
    expect(JSON.stringify(stored)).not.toContain('second');
  });

  it('totals are recomputed from the stored cells, so a client-sent total changes nothing', async () => {
    const b = await booking();
    const [a, c] = await twoRows(b);
    const response = await rpcForm('entries.save', b.who, {
      weekStart: WEEK,
      ...cell(a, 0, '8'),
      ...cell(a, 1, '7.5'),
      ...cell(c, 1, '0.25'),
      total: '9999',
      'day.0.total': '1',
    });
    expect(response.status).toBe(200);
    const week = await weekOf(b.who, WEEK);
    expect(week.rows.map((r) => rowTotal(r.cells))).toEqual([1550, 25]);
    expect(dayTotals(week.rows)).toEqual([800, 775, 0, 0, 0, 0, 0]);
    expect(weekTotal(week.rows)).toBe(1575);
  });

  it('a cell sent with only its hours or only its note is refused', async () => {
    const b = await booking();
    const [row] = await twoRows(b);
    const response = await rpcForm('entries.save', b.who, {
      weekStart: WEEK,
      [`cell.${row}.0.hours`]: '5',
    });
    expect(response.status).toBe(400);
  });

  it('a submitted week rejects the owner and writes nothing', async () => {
    const b = await booking();
    const [row] = await twoRows(b);
    await save(b.who, WEEK, cell(row, 0, '5'));
    await env.DB.exec(
      `INSERT INTO week_submission (person_id, week_start, state, submitted_at) VALUES ('${b.who.personId}', '${WEEK}', 'submitted', 1);`,
    );
    const locked = await save(b.who, WEEK, cell(row, 0, '6'));
    expect(locked.status).toBe(403);
    expect(await messageOf(locked)).toMatch(/locked/);
    expect((await hoursOf(b, WEEK))[0]?.[0]).toBe(500);
    expect((await rpcForm('entries.copyLastWeek', b.who, { weekStart: WEEK })).status).toBe(403);
    expect(
      (await rpcForm('entries.removeRow', b.who, { weekStart: WEEK, rowId: row })).status,
    ).toBe(403);
    expect(
      (
        await rpcForm('entries.addRow', b.who, {
          weekStart: WEEK,
          projectId: b.projectId,
          taskCodeId: b.tasks[0]?.id ?? '',
        })
      ).status,
    ).toBe(403);
  });
});

describe('entries.save from the island', () => {
  it('the island posts multipart form data, and it saves exactly what the no-script form would', async () => {
    const b = await booking();
    const [row] = await twoRows(b);
    const fields = { weekStart: WEEK, ...cell(row, 2, '3.25', 'by script') };
    expect((await rpcMultipart('entries.save', b.who, fields)).status).toBe(200);
    expect((await weekOf(b.who, WEEK)).rows[0]?.cells[2]).toEqual({
      hundredths: 325,
      note: 'by script',
    });
    expect((await rpcMultipart('entries.save', null, fields)).status).toBe(401);
    const wrong = { ...b.who, token: 'wrong' };
    expect((await rpcMultipart('entries.save', wrong, fields)).status).toBe(403);
  });
});
