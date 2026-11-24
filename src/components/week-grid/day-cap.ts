// The 24 hour day as the grid shows it. The Action is the authority and refuses the same save; the grid reads
// the cap and the words from the same places the server does, so a person sees the problem before the post.
import { DAY_CAP } from '../../lib/hours';
import { errorMessage } from '../../lib/errors';
import { dayTotals, DAY_NAMES, type Cell } from '../../lib/week';

/** The days, Monday 0, whose total over every row passes the cap. */
export function overDays(
  rows: readonly { cells: readonly Pick<Cell, 'hundredths'>[] }[],
): number[] {
  return dayTotals(rows).flatMap((total, dow) => (total > DAY_CAP ? [dow] : []));
}

/** The catalog's day cap message naming the day, exactly as the server returns it. */
export const dayCapMessage = (dow: number): string => errorMessage('day_cap', DAY_NAMES[dow]);
