// How a person reads a date on screen: day first, the month in words. Table data, addresses and CSV keep ISO.
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** "16 November 2026" from a `YYYY-MM-DD` civil date. */
export function writtenDate(date: string): string {
  const [year = '', month = '', day = ''] = date.split('-');
  return `${String(Number(day))} ${MONTHS[Number(month) - 1] ?? ''} ${year}`;
}

/** "18:57": the hour and minute of an instant in UTC. */
export function clockUtc(ms: number): string {
  return new Date(ms).toISOString().slice(11, 16);
}
