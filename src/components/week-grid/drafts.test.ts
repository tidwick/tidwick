import { describe, expect, it } from 'vitest';
import { dayTotals, rowTotal, weekTotal, type GridRow } from '../../lib/week';
import { cellField } from '../../lib/week-form';
import { dirtyFields, draftKey, hoursInvalid, hoursText, settled, withDrafts } from './drafts';

function row(rowId: string, hours: number[]): GridRow {
  return {
    rowId,
    client: 'Client',
    project: 'Project',
    projectId: 'p',
    taskCode: 'T',
    task: 'Task',
    removable: false,
    cells: Array.from({ length: 7 }, (_, dow) => ({ hundredths: hours[dow] ?? 0, note: '' })),
  };
}

const rows = [row('a', [800, 800, 0, 0, 0, 0, 0]), row('b', [0, 125, 0, 0, 0, 0, 0])];

describe('unsaved edits in the grid', () => {
  it('row, day and week totals update live from drafts, in integer hundredths', () => {
    const drafts = {
      [draftKey('a', 2)]: { hours: '7.5' },
      [draftKey('b', 1)]: { hours: '0.255' },
      [draftKey('b', 6)]: { hours: '2' },
    };
    const shown = withDrafts(rows, drafts);
    expect(shown.map((r) => rowTotal(r.cells))).toEqual([2350, 226]);
    expect(dayTotals(shown)).toEqual([800, 826, 750, 0, 0, 0, 200]);
    expect(weekTotal(shown)).toBe(2576);
    expect(weekTotal(rows)).toBe(1725);
  });

  it('hours that are not a number leave the stored value in the totals and mark the cell', () => {
    const drafts = { [draftKey('a', 0)]: { hours: '8x' } };
    expect(hoursInvalid(drafts[draftKey('a', 0)])).toBe(true);
    expect(weekTotal(withDrafts(rows, drafts))).toBe(weekTotal(rows));
    expect(hoursInvalid({ hours: '' })).toBe(false);
    expect(hoursInvalid(undefined)).toBe(false);
  });

  it('only cells whose draft differs from the server are posted, with both fields, hours as typed', () => {
    const drafts = {
      [draftKey('a', 0)]: { hours: '8.00' },
      [draftKey('a', 1)]: { hours: '6' },
      [draftKey('b', 3)]: { note: '  called the supplier ' },
      [draftKey('b', 4)]: { hours: '' },
    };
    expect(dirtyFields(rows, drafts)).toEqual({
      [cellField('a', 1, 'hours')]: '6',
      [cellField('a', 1, 'note')]: '',
      [cellField('b', 3, 'hours')]: '',
      [cellField('b', 3, 'note')]: '  called the supplier ',
    });
    expect(dirtyFields(rows, {})).toEqual({});
  });

  it('a cell shows stored hours until it is drafted, and a blank cell shows nothing', () => {
    expect(hoursText({ hundredths: 125, note: '' }, undefined)).toBe('1.25');
    expect(hoursText({ hundredths: 0, note: '' }, undefined)).toBe('');
    expect(hoursText({ hundredths: 125, note: '' }, { hours: '3' })).toBe('3');
  });

  it('a save settles the drafts it posted and keeps one typed after it was posted', () => {
    const drafts = {
      [draftKey('a', 1)]: { hours: '6' },
      [draftKey('a', 2)]: { hours: '4.5' },
    };
    const posted = {
      [cellField('a', 1, 'hours')]: '6',
      [cellField('a', 1, 'note')]: '',
      [cellField('a', 2, 'hours')]: '4',
      [cellField('a', 2, 'note')]: '',
    };
    expect(settled(drafts, posted)).toEqual({ [draftKey('a', 2)]: { hours: '4.5' } });
  });
});
