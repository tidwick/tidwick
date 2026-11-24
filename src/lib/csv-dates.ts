// Civil dates in the three layouts a CSV mapping names: ISO, month first and day first. Pure string work.
import type { DateFormat } from './csv-mapping';
import { weekdayOf } from './week';

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const SLASHED = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

const two = (n: string | number): string => String(n).padStart(2, '0');

/** An ISO date as the mapping's layout writes it. */
export function formatDate(iso: string, format: DateFormat): string {
  const [year = '', month = '', day = ''] = iso.split('-');
  if (format === 'mdy') return `${month}/${day}/${year}`;
  if (format === 'dmy') return `${day}/${month}/${year}`;
  return iso;
}

/** Text in the mapping's layout as an ISO date, or null when it is not a real calendar date. */
export function parseDate(text: string, format: DateFormat): string | null {
  const value = text.trim();
  let iso: string | null = null;
  if (format === 'iso') {
    iso = ISO.test(value) ? value : null;
  } else {
    const match = SLASHED.exec(value);
    if (match) {
      const [, first = '', second = '', year = ''] = match;
      iso =
        format === 'mdy'
          ? `${year}-${two(first)}-${two(second)}`
          : `${year}-${two(second)}-${two(first)}`;
    }
  }
  return iso !== null && weekdayOf(iso) !== null ? iso : null;
}
