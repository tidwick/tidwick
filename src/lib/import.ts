// Reading a time-tracking CSV through the adopter's import mapping: header lookup and the checks one row can
// fail on its own. What needs the database (people, projects, task codes, existing hours) is `import-plan.ts`.
// Only the columns the mapping names are read (SEC-25). Pure.
import { parseCsv } from './csv';
import { parseDate } from './csv-dates';
import type { ImportMapping } from './csv-mapping';
import { fail } from './errors';
import { DAY_CAP, parseHours } from './hours';
import { parseProjectNumber } from './project-number';
import { NOTE_MAX, weekStartOf, weekdayOf } from './week';

/** The most a file may weigh and hold, which keeps one apply inside D1's query budget. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;

export interface ImportRow {
  /** Line number in the file, the header being line 1. */
  line: number;
  email: string;
  client: string;
  project: string;
  projectNumber: string | null;
  task: string;
  date: string;
  dow: number;
  weekStart: string;
  hundredths: number;
  /** The hours had more than two decimal places and were rounded half up. */
  rounded: boolean;
  note: string;
}

export interface Rejection {
  line: number;
  reason: string;
}

export interface ReadResult {
  rowsRead: number;
  rows: ImportRow[];
  rejected: Rejection[];
}

const EMAIL = /^[^\s@,]+@[^\s@,]+$/;
const MORE_THAN_TWO_DECIMALS = /[.,]\d{2}\d*[1-9]/;

const shown = (value: string): string => {
  const text = Array.from(value.trim()).slice(0, 40).join('');
  return `"${text}"`;
};

/** Column positions for the headers the mapping names; a header the file lacks is `invalid_input`. */
function columns(header: readonly string[], mapping: ImportMapping): Record<string, number> {
  const at = new Map<string, number>();
  header.forEach((name, i) => {
    const key = name.trim().toLowerCase();
    if (!at.has(key)) at.set(key, i);
  });
  const found: Record<string, number> = {};
  for (const [field, name] of Object.entries(mapping.headers)) {
    if (name === undefined) continue;
    const index = at.get(name.toLowerCase());
    if (index === undefined) fail('invalid_input', `the file has no column named "${name}"`);
    found[field] = index;
  }
  return found;
}

/** One row's own checks; returns the row or the reason it cannot be read. */
function readRow(
  cells: readonly string[],
  at: Record<string, number>,
  line: number,
  mapping: ImportMapping,
): ImportRow | string {
  const get = (field: string): string => (cells[at[field] ?? -1] ?? '').trim();
  const email = get('person_email');
  if (!EMAIL.test(email)) return `bad email ${shown(email)}`;
  for (const field of ['client', 'project', 'task'] as const) {
    if (get(field) === '') return `missing ${field}`;
  }
  const date = parseDate(get('date'), mapping.date_format);
  const weekday = date === null ? null : weekdayOf(date);
  if (date === null || weekday === null) return `bad date ${shown(get('date'))}`;
  const hundredths = parseHours(get('hours'));
  if (hundredths === null) return `bad hours ${shown(get('hours'))}`;
  if (hundredths > DAY_CAP) return 'day over 24 hours';
  const number = parseProjectNumber(get('project_number'));
  if (!number.ok) return `malformed project number ${shown(get('project_number'))}`;
  const note = get('note');
  if (note.length > NOTE_MAX) return 'note over 2000 characters';
  if (hundredths === 0 && note === '') return 'no hours and no note';
  return {
    line,
    email,
    client: get('client'),
    project: get('project'),
    projectNumber: number.number,
    task: get('task'),
    date,
    dow: weekday,
    weekStart: weekStartOf(date) ?? date,
    hundredths,
    rounded: MORE_THAN_TWO_DECIMALS.test(get('hours')),
    note,
  };
}

/** Parses the file and applies each row's own checks; a file over the caps or with a mapped column missing is refused. */
export function readImport(text: string, mapping: ImportMapping): ReadResult {
  if (text.length > MAX_IMPORT_BYTES)
    fail('invalid_input', 'the file is over 2 MB; split it by date range');
  const [header, ...body] = parseCsv(text);
  if (header === undefined) fail('invalid_input', 'the file is empty');
  if (body.length > MAX_IMPORT_ROWS) {
    fail(
      'invalid_input',
      `the file has more than ${String(MAX_IMPORT_ROWS)} rows; split it by date range`,
    );
  }
  const at = columns(header, mapping);
  const rows: ImportRow[] = [];
  const rejected: Rejection[] = [];
  body.forEach((cells, i) => {
    const line = i + 2;
    if (cells.length !== header.length) {
      rejected.push({
        line,
        reason: `malformed row: expected ${String(header.length)} cells, found ${String(cells.length)}`,
      });
      return;
    }
    const row = readRow(cells, at, line, mapping);
    if (typeof row === 'string') rejected.push({ line, reason: row });
    else rows.push(row);
  });
  return { rowsRead: body.length, rows, rejected };
}
