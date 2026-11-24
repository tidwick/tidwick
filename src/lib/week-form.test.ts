import { describe, expect, it } from 'vitest';
import { cellField, readCells } from './week-form';

describe('week form fields', () => {
  it('cell fields round-trip through the reader, with hours in hundredths and notes trimmed', () => {
    const fields = {
      [cellField('row-1', 0, 'hours')]: '7.5',
      [cellField('row-1', 0, 'note')]: '  site visit ',
      [cellField('row-1', 6, 'hours')]: '',
      [cellField('row-1', 6, 'note')]: '',
      weekStart: '2026-01-05',
    };
    expect(readCells(fields)).toEqual({
      edits: [
        { rowId: 'row-1', dow: 0, hundredths: 750, note: 'site visit' },
        { rowId: 'row-1', dow: 6, hundredths: 0, note: '' },
      ],
      problems: [],
    });
  });

  it('each bad cell is a problem that names its day, and good cells still read', () => {
    const fields = {
      [cellField('r', 1, 'hours')]: 'x',
      [cellField('r', 1, 'note')]: '',
      [cellField('r', 2, 'hours')]: '24.01',
      [cellField('r', 2, 'note')]: '',
      [cellField('r', 3, 'hours')]: '1',
      [cellField('r', 3, 'note')]: 'n'.repeat(2001),
      [cellField('r', 4, 'hours')]: '2',
      [cellField('r', 4, 'note')]: '',
      [cellField('r', 5, 'hours')]: '3',
    };
    const { edits, problems } = readCells(fields);
    expect(edits).toEqual([{ rowId: 'r', dow: 4, hundredths: 200, note: '' }]);
    expect(problems).toHaveLength(4);
    expect(problems[0]).toMatch(/^Tuesday/);
    expect(problems.join('|')).toMatch(/Wednesday.*24 hours/);
    expect(problems.join('|')).toMatch(/Thursday.*2000/);
    expect(problems.join('|')).toMatch(/Saturday.*both be sent/);
  });

  it('a field that starts with cell. but is not a cell field is a problem, and other fields are skipped', () => {
    expect(readCells({ 'cell.r.9.hours': '1', 'cell.r.1.minutes': '1' }).problems).toHaveLength(2);
    expect(readCells({ weekStart: '2026-01-05', total: '9' })).toEqual({ edits: [], problems: [] });
  });
});
