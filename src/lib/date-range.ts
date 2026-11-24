// A closed range of civil dates for an export or report, checked once.
import { fail } from './errors';
import { weekdayOf } from './week';

export interface DateRange {
  from: string;
  to: string;
}

/**
 * The longest range one file covers in days; the rows an export may hold are capped apart, by `MAX_EXPORT_ROWS`
 * and `MAX_EXPORT_BYTES`.
 */
export const MAX_RANGE_DAYS = 366;

const dayNumber = (date: string): number => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/** `from` and `to` as typed; both must be real dates, `from` not after `to`, the span at most a year. */
export function parseRange(from: unknown, to: unknown): DateRange {
  if (typeof from !== 'string' || typeof to !== 'string')
    fail('invalid_input', 'choose a start and end date');
  if (weekdayOf(from) === null || weekdayOf(to) === null)
    fail('invalid_input', 'dates are YYYY-MM-DD');
  if (from > to) fail('invalid_input', 'the start date is after the end date');
  if (dayNumber(to) - dayNumber(from) >= MAX_RANGE_DAYS) {
    fail('invalid_input', `a range covers at most ${String(MAX_RANGE_DAYS)} days`);
  }
  return { from, to };
}

/** The last full calendar month before the month that holds `today` (a civil date): where a range form opens. */
export function lastFullMonth(today: string): DateRange {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}
