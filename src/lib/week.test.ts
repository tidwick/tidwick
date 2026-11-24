import { describe, expect, it } from 'vitest';
import { seededWeek } from '../../test/seed/week';
import {
  addDays,
  dayTotals,
  isRemovable,
  isWeekStart,
  neighbourWeek,
  rowTotal,
  todayIn,
  weekDates,
  weekStartOf,
  weekTotal,
} from './week';

describe('week totals', () => {
  const people = seededWeek(40);

  it('the seeded week has 40 people, notes, and note-only zero-hour cells', () => {
    const cells = people.flatMap((p) => p.rows.flatMap((r) => r.cells));
    expect(people).toHaveLength(40);
    expect(cells.some((c) => c.note !== '' && c.hundredths > 0)).toBe(true);
    expect(cells.some((c) => c.note !== '' && c.hundredths === 0)).toBe(true);
    expect(cells.some((c) => c.hundredths > 0 && c.hundredths % 100 !== 0)).toBe(true);
  });

  it('row, day and week totals equal an independent sum over the seeded week', () => {
    for (const person of people) {
      // The independent computation: a flat list of (row, day, hundredths) triples summed into Maps.
      const triples: [string, number, number][] = [];
      for (const row of person.rows) {
        for (let dow = 0; dow < 7; dow++)
          triples.push([row.rowId, dow, row.cells[dow]?.hundredths ?? 0]);
      }
      const byRow = new Map<string, number>();
      const byDay = new Map<number, number>();
      let all = 0;
      for (const [rowId, dow, h] of triples) {
        byRow.set(rowId, (byRow.get(rowId) ?? 0) + h);
        byDay.set(dow, (byDay.get(dow) ?? 0) + h);
        all += h;
      }
      for (const row of person.rows) expect(rowTotal(row.cells)).toBe(byRow.get(row.rowId));
      expect(dayTotals(person.rows)).toEqual([0, 1, 2, 3, 4, 5, 6].map((d) => byDay.get(d) ?? 0));
      expect(weekTotal(person.rows)).toBe(all);
      expect(all).toBeGreaterThan(0);
    }
  });

  it('totals are integers in hundredths, so tenths and quarters add with no float drift', () => {
    const row = { cells: [10, 20, 10, 20, 10, 20, 10].map((hundredths) => ({ hundredths })) };
    expect(rowTotal(row.cells)).toBe(100);
    expect(weekTotal([row, row])).toBe(200);
    expect(Number.isInteger(weekTotal(people.flatMap((p) => p.rows)))).toBe(true);
  });

  it('a row can be removed only when every cell is blank, and a zero cell with a note is not blank', () => {
    const blank = Array.from({ length: 7 }, () => ({ hundredths: 0, note: '' }));
    expect(isRemovable(blank)).toBe(true);
    expect(isRemovable([{ hundredths: 0, note: 'kept' }, ...blank.slice(1)])).toBe(false);
    expect(isRemovable([{ hundredths: 5, note: '' }, ...blank.slice(1)])).toBe(false);
  });
});

describe('week dates', () => {
  it('weeks start on Monday and any date finds its Monday', () => {
    expect(isWeekStart('2026-01-05')).toBe(true);
    expect(isWeekStart('2026-01-06')).toBe(false);
    expect(weekStartOf('2026-01-11')).toBe('2026-01-05');
    expect(weekStartOf('2026-01-05')).toBe('2026-01-05');
    expect(weekStartOf('2026-03-01')).toBe('2026-02-23');
  });

  it('text that is not a real date has no week', () => {
    for (const bad of ['garbage', '2026-02-30', '2026-13-01', '2026-1-5', '']) {
      expect(weekStartOf(bad), bad).toBeNull();
      expect(isWeekStart(bad), bad).toBe(false);
    }
  });

  it('a date past the last or before the first year has no week, and a week at either end has no neighbour past it', () => {
    expect(weekStartOf('9999-12-27')).toBeNull();
    expect(weekStartOf('1899-12-31')).toBeNull();
    expect(neighbourWeek('2026-01-05', 1)).toBe('2026-01-12');
    expect(neighbourWeek('2026-01-05', -1)).toBe('2025-12-29');
    expect(neighbourWeek('9990-12-31', 1)).toBeNull();
    expect(neighbourWeek('1900-01-01', -1)).toBeNull();
    expect(neighbourWeek('9990-12-24', 1)).toBe('9990-12-31');
  });

  it('a week lists seven dates across month and year ends', () => {
    expect(weekDates('2026-12-28')).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ]);
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it("today is read in the adopter's time zone", () => {
    const instant = Date.UTC(2026, 0, 6, 3, 30);
    expect(todayIn('UTC', instant)).toBe('2026-01-06');
    expect(todayIn('America/Los_Angeles', instant)).toBe('2026-01-05');
    expect(todayIn('Not/AZone', instant)).toBe('2026-01-06');
  });
});
