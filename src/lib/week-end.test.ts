import { describe, expect, it } from 'vitest';
import { completedWeeks, weekEndsAt } from './week-end';

describe('when a week ends', () => {
  it('is midnight at the start of the next Monday in the firm zone, across a clock change', () => {
    expect(weekEndsAt('2026-01-05', 'UTC')).toBe(Date.UTC(2026, 0, 12));
    expect(weekEndsAt('2026-01-05', 'America/New_York')).toBe(Date.UTC(2026, 0, 12, 5));
    expect(weekEndsAt('2026-01-05', 'Asia/Kolkata')).toBe(Date.UTC(2026, 0, 11, 18, 30));
    // The week of 2026-03-02 ends after New York's clocks moved forward on the 8th.
    expect(weekEndsAt('2026-03-02', 'America/New_York')).toBe(Date.UTC(2026, 2, 9, 4));
    expect(weekEndsAt('2026-01-05', 'Not/AZone')).toBe(Date.UTC(2026, 0, 12));
  });

  it('lists the completed weeks before the one a date is in, newest first', () => {
    expect(completedWeeks('2026-11-26', 4)).toEqual([
      '2026-11-16',
      '2026-11-09',
      '2026-11-02',
      '2026-10-26',
    ]);
    expect(completedWeeks('2026-11-23', 1)).toEqual(['2026-11-16']);
    expect(completedWeeks('2026-11-29', 1)).toEqual(['2026-11-16']);
  });
});
