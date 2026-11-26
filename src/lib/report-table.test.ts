import { describe, expect, it } from 'vitest';
import { reportTable } from './report-table';

describe('reportTable', () => {
  it('pivots a group’s state rows into one line and totals every column', () => {
    const table = reportTable('client', [
      { keys: ['Acme'], state: 'approved', hundredths: 400 },
      { keys: ['Acme'], state: 'draft', hundredths: 150 },
      { keys: ['Birch'], state: 'returned', hundredths: 25 },
    ]);
    expect(table.heads).toEqual(['Client']);
    expect(
      table.lines.map((l) => [l.keys[0], l.hundredths.approved, l.hundredths.draft, l.total]),
    ).toEqual([
      ['Acme', 400, 150, 550],
      ['Birch', 0, 0, 25],
    ]);
    expect(table.totals).toMatchObject({
      total: 575,
      hundredths: { approved: 400, draft: 150, returned: 25, submitted: 0 },
    });
  });

  it('is empty, with zero totals, when there are no rows', () => {
    expect(reportTable('week', [])).toMatchObject({ lines: [], totals: { total: 0 } });
  });
});
