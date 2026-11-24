// A three-row week for the DOM tests: invented projects, whole hours, and a note on one cell. `renderGrid`
// mounts the island as the page does, with a stand-in for each prop the page would build.
import { render, screen } from '@testing-library/react';
import type { GridRow } from '../../lib/week';
import { WeekGrid, type WeekGridProps } from './week-grid';

export const DAYS = [
  '2026-01-05',
  '2026-01-06',
  '2026-01-07',
  '2026-01-08',
  '2026-01-09',
  '2026-01-10',
  '2026-01-11',
];

export const DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/** A row with `hundredths` on each of the given days and a note on Monday when `note` is set. */
export function row(
  id: string,
  project: string,
  task: string,
  hundredths: Record<number, number> = {},
  note = '',
): GridRow {
  return {
    rowId: id,
    client: 'Alder Street Bakery',
    project,
    projectId: `p-${id}`,
    taskCode: task.slice(0, 3).toUpperCase(),
    task,
    removable: Object.keys(hundredths).length === 0 && note === '',
    cells: Array.from({ length: 7 }, (_, dow) => ({
      hundredths: hundredths[dow] ?? 0,
      note: dow === 0 ? note : '',
    })),
  };
}

/** Kitchen refit has Design (8 hours Tuesday, a Monday note) and Review (8 hours Tuesday); Garden wall is empty. */
export const ROWS = [
  row('r1', 'Kitchen refit', 'Design', { 1: 800 }, 'site visit'),
  row('r2', 'Kitchen refit', 'Review', { 1: 800 }),
  row('r3', 'Garden wall', 'Survey'),
];

export const hoursLabel = (project: string, task: string, day: string): string =>
  `Hours, ${project}, ${task}, ${day}`;

/** The note field of one day, by the label a screen reader reads. */
export const note = (project: string, task: string, day: string): HTMLTextAreaElement =>
  screen.getByLabelText<HTMLTextAreaElement>(`Note, ${project}, ${task}, ${day}`);

/** A row's notes toggle, the `<summary>` whose text is "Notes", then the count of written notes, then ", <project>, <task>". */
export function toggle(label: string): HTMLElement {
  const found = [...document.querySelectorAll('summary')].find((summary) =>
    new RegExp(`^Notes( \\(\\d+\\))?, ${label}$`).test(summary.textContent),
  );
  if (!found) throw new TypeError(`no notes toggle for ${label}`);
  return found;
}

/** The `<details>` that opens a row's ledger. */
export function ledger(label: string): HTMLDetailsElement {
  const details = toggle(label).parentElement;
  if (!(details instanceof HTMLDetailsElement)) throw new TypeError(`no ledger for ${label}`);
  return details;
}

export function renderGrid(overrides: Partial<WeekGridProps> = {}) {
  return render(
    <WeekGrid
      mode="own"
      personId=""
      editing={false}
      path="/week/2026-01-05"
      csrf="token"
      weekStart="2026-01-05"
      days={DAYS}
      state="draft"
      rows={ROWS}
      options={[]}
      addProjectId=""
      problem={null}
      noteLimit={null}
      {...overrides}
    />,
  );
}
