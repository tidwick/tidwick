// The instant a week ends in the firm's time zone: midnight at the start of the Monday after it.
import { addDays } from './week';

/** The offset of a zone from UTC at an instant, in milliseconds; an unknown zone is UTC. */
function offsetAt(timeZone: string, at: number): number {
  let name: string | undefined;
  try {
    name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value;
  } catch {
    return 0;
  }
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name ?? '');
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return (match[1] === '-' ? -1 : 1) * minutes * 60_000;
}

/** The instant a week that starts on `weekStart` ends in `timeZone`. */
export function weekEndsAt(weekStart: string, timeZone: string): number {
  const utc = Date.parse(`${addDays(weekStart, 7)}T00:00:00Z`);
  // The offset at the guess may sit across a clock change from the offset at midnight itself, so settle it twice.
  const guess = utc - offsetAt(timeZone, utc);
  return utc - offsetAt(timeZone, guess);
}

/** The `count` weeks that ended before this one began, newest first, as the Mondays they started on. */
export function completedWeeks(today: string, count: number): string[] {
  const monday = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  return Array.from({ length: count }, (_, i) => addDays(monday, -7 * (i + 1)));
}
