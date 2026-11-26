import { describe, expect, it } from 'vitest';
import { lastFullMonth, parseRange } from './date-range';
import { DEFAULT_POLICY } from './policy';

describe('the range an export or report opens on is the last full calendar month', () => {
  it('names the first and last day of the month before the one that holds today', () => {
    expect(lastFullMonth('2026-11-22')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(lastFullMonth('2026-11-01')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(lastFullMonth('2026-10-31')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('crosses a year start and ends a leap February on the 29th', () => {
    expect(lastFullMonth('2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(lastFullMonth('2024-03-10')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(lastFullMonth('2026-03-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('is a range the export and report accept, whatever the month', () => {
    for (const today of ['2026-01-31', '2026-05-31', '2028-03-01', '2031-12-25']) {
      const { from, to } = lastFullMonth(today);
      expect(parseRange(from, to, DEFAULT_POLICY.reportMaxDays)).toEqual({ from, to });
    }
  });
});
