import { describe, expect, it } from 'vitest';
import { clockUtc, writtenDate } from './dates';
import { dayLabel } from './week';

describe('people read dates day first, in words', () => {
  it('a civil date is written as day, month name and year', () => {
    expect(writtenDate('2026-11-16')).toBe('16 November 2026');
    expect(writtenDate('2031-03-03')).toBe('3 March 2031');
    expect(writtenDate('2026-01-05')).toBe('5 January 2026');
  });

  it('a column heading is the weekday, the day and the short month, never month first', () => {
    expect(dayLabel('2026-11-16', 0)).toBe('Mon 16 Nov');
    expect(dayLabel('2026-01-11', 6)).toBe('Sun 11 Jan');
    expect(dayLabel('2026-03-03', 1)).not.toMatch(/\d\/\d/);
  });

  it('an instant is read as the hour and minute in UTC, with no seconds or zone name', () => {
    expect(clockUtc(Date.UTC(2026, 10, 22, 18, 57, 57))).toBe('18:57');
    expect(clockUtc(Date.UTC(2026, 0, 1, 0, 5, 0))).toBe('00:05');
  });
});
