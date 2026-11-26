import { describe, expect, it } from 'vitest';
import { NOTE_SHOWN, cellFields, weekOutput } from './cells';
import type { WeekView } from '../lib/week';

const blank = { hundredths: 0, note: '' };
const week: WeekView = {
  weekStart: '2026-01-05',
  state: 'draft',
  rows: [
    {
      rowId: 'r1',
      client: 'C',
      project: 'P',
      projectId: 'p',
      taskCode: 'T',
      task: 'Task',
      assigned: true,
      removable: false,
      cells: [
        { hundredths: 400, note: 'x'.repeat(NOTE_SHOWN + 20) },
        blank,
        blank,
        blank,
        { hundredths: 0, note: 'only a note' },
        blank,
        blank,
      ],
    },
  ],
};

describe('what an agent reads of a week', () => {
  it('shows has_note and no note while notes are off', () => {
    const [row] = weekOutput(week, 'off').rows;
    expect(row?.cells).toEqual([
      { day: 0, hundredths: 400, has_note: true },
      { day: 4, hundredths: 0, has_note: true },
    ]);
  });

  it('shows notes capped at 500 characters when notes are read', () => {
    const [row] = weekOutput(week, 'read').rows;
    expect(row?.cells[0]?.note).toHaveLength(NOTE_SHOWN);
    expect(row?.cells[1]?.note).toBe('only a note');
  });
});

describe('what an agent writes', () => {
  it('keeps the stored note of a cell sent with none, and sends an empty note as clearing it', () => {
    const fields = cellFields(
      [
        { rowId: 'r1', day: 4, hours: 2 },
        { rowId: 'r1', day: 0, hours: '1.5', note: '' },
        { rowId: 'r1', day: 6, hours: 1 },
      ],
      week,
    );
    expect(fields).toEqual({
      'cell.r1.4.hours': '2',
      'cell.r1.4.note': 'only a note',
      'cell.r1.0.hours': '1.5',
      'cell.r1.0.note': '',
      'cell.r1.6.hours': '1',
      'cell.r1.6.note': '',
    });
  });
});
