// The week as plain data and integer arithmetic. The server render, the Actions and the island all import this,
// so a total is computed one way everywhere. Weeks run Monday to Sunday; Monday is day 0.

export const DAYS_IN_WEEK = 7;

export const DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

/** A note is at most this many characters. */
export const NOTE_MAX = 2000;

export interface Cell {
  /** Hours in hundredths, 0 for a blank cell. */
  hundredths: number;
  /** The note as text, empty for none. */
  note: string;
}

export interface GridRow {
  rowId: string;
  client: string;
  project: string;
  projectId: string;
  taskCode: string;
  task: string;
  /** Whether the server would accept removing this row now. */
  removable: boolean;
  /** Seven cells, Monday first. */
  cells: Cell[];
}

export type WeekState = 'draft' | 'submitted' | 'approved' | 'returned';

/** The canonical week every Action returns and the page renders from. */
export interface WeekView {
  weekStart: string;
  state: WeekState;
  rows: GridRow[];
}

/** The week an Action returns: the view, with the fingerprint a later submit or decision on it can carry. */
export interface LoadedWeek extends WeekView {
  fingerprint: string;
}

/** Whether the owner may still edit: a submitted or approved week is locked. */
export function isEditable(state: WeekState): boolean {
  return state === 'draft' || state === 'returned';
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The years a civil date may name, so a week's neighbours (seven days either way) never leave four digits. */
export const FIRST_YEAR = 1900;
export const LAST_YEAR = 9990;

function parseDate(date: string): Date | null {
  const match = DATE.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  if (year < FIRST_YEAR || year > LAST_YEAR) return null;
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return parsed.toISOString().slice(0, 10) === date ? parsed : null;
}

/** The weekday of a civil date, Monday 0 to Sunday 6; null for text that is not a real date. */
export function weekdayOf(date: string): number | null {
  const parsed = parseDate(date);
  return parsed === null ? null : (parsed.getUTCDay() + 6) % 7;
}

export function isWeekStart(date: string): boolean {
  return weekdayOf(date) === 0;
}

/** The date `days` after (or before, when negative) a civil date. */
export function addDays(date: string, days: number): string {
  const parsed = parseDate(date);
  if (parsed === null) throw new RangeError(`not a date: ${date}`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** The Monday of the week holding `date`, or null for text that is not a real date. */
export function weekStartOf(date: string): string | null {
  const weekday = weekdayOf(date);
  return weekday === null ? null : addDays(date, -weekday);
}

/** The week start `weeks` before (negative) or after a week start, or null when it falls outside the years a date may name. */
export function neighbourWeek(weekStart: string, weeks: number): string | null {
  const moved = addDays(weekStart, weeks * DAYS_IN_WEEK);
  return weekdayOf(moved) === null ? null : moved;
}

/** The seven dates of a week, Monday first. */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: DAYS_IN_WEEK }, (_, dow) => addDays(weekStart, dow));
}

/** Today's civil date in a time zone (an IANA name); an unknown zone falls back to UTC. */
export function todayIn(timeZone: string, now: number): string {
  let zone = timeZone;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone });
  } catch {
    zone = 'UTC';
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

const sum = (values: readonly number[]): number => values.reduce((total, v) => total + v, 0);

/** One row's total across the week. */
export function rowTotal(cells: readonly Pick<Cell, 'hundredths'>[]): number {
  return sum(cells.map((cell) => cell.hundredths));
}

/** The seven day totals across every row. */
export function dayTotals(
  rows: readonly { cells: readonly Pick<Cell, 'hundredths'>[] }[],
): number[] {
  return Array.from({ length: DAYS_IN_WEEK }, (_, dow) =>
    sum(rows.map((row) => row.cells[dow]?.hundredths ?? 0)),
  );
}

/** The week's total across every row and day. */
export function weekTotal(rows: readonly { cells: readonly Pick<Cell, 'hundredths'>[] }[]): number {
  return sum(rows.map((row) => rowTotal(row.cells)));
}

/** A cell with no hours and no note holds nothing and has no stored entry. */
export function isBlank(cell: Cell): boolean {
  return cell.hundredths === 0 && cell.note === '';
}

/** A row can be removed only when every cell is blank (a zero cell carrying a note is not). */
export function isRemovable(cells: readonly Cell[]): boolean {
  return cells.every(isBlank);
}

/** A task a person may book to a project: an allowed, live task code. */
export interface TaskOption {
  taskCodeId: string;
  code: string;
  name: string;
}

/** A project the person is assigned to, with the tasks they may book to it. */
export interface ProjectOption {
  projectId: string;
  client: string;
  project: string;
  tasks: TaskOption[];
}

/** Why add-row has nothing to pick: the person has no assignment, a project has no tasks, or no project exists. */
export type EmptyCause =
  | { kind: 'unassigned'; stewards: string[] }
  | { kind: 'no_tasks'; projects: { projectId: string; name: string }[] }
  | { kind: 'no_projects' };

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** A column heading for a day: "Mon 16 Nov", day before month as everywhere a person reads a date. */
export function dayLabel(date: string, dow: number): string {
  const [, month = '', day = ''] = date.split('-');
  return `${DAY_NAMES[dow]?.slice(0, 3) ?? ''} ${String(Number(day))} ${SHORT_MONTHS[Number(month) - 1] ?? ''}`;
}
