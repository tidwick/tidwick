// The demo seed's time: thirteen weeks, about three months, ending with the week the seed is loaded in, for every
// demo person. Most days carry a note, sealed under the client's key by the same `sealNote` the app uses. The
// current week is a draft, most of last week is submitted, and the weeks before are approved with a few returned.
import { addDays } from '../../src/lib/week.ts';
import { sealedSeedNote } from '../seed/keys.ts';
import {
  DEMO_ACCOUNTANTS,
  demoAssigned,
  demoId,
  demoPeople,
  firmOf,
  taskId,
  type DemoProject,
  type TaskCode,
} from './build.ts';
import { noteFor } from './notes.ts';

export const DEMO_WEEKS = 13;

const DAY_MS = 24 * 60 * 60 * 1000;
const WORKING_DAYS = [0, 1, 2, 3, 4];
const MAIN_TASKS: readonly TaskCode[] = ['DSGN', 'DOCS', 'PLAN', 'DSGN', 'SITE', 'QUAL'];
const SECOND_TASKS: readonly TaskCode[] = ['MEET', 'SITE', 'DOCS', 'PLAN'];

export type DemoState = 'submitted' | 'approved' | 'returned' | null;

/** The state of person `n`'s week `back` weeks before the current one; null is a draft. */
export function demoState(n: number, back: number): DemoState {
  if (back === 0) return null;
  if (back === 1) return n % 5 === 4 ? null : 'submitted';
  if (back === 2) return n % 8 === 3 ? 'returned' : n % 11 === 6 ? 'submitted' : 'approved';
  return (n + back) % 17 === 0 ? 'returned' : 'approved';
}

/** A small linear congruential generator, read from its high bits since its low bits repeat every few draws. */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return Math.floor(state / 65536);
  };
}

interface Row {
  project: DemoProject;
  task: TaskCode;
  /** Hundredths for each day Monday (0) to Sunday (6); absent days have no entry. */
  days: Map<number, number>;
}

/** The weeks since 1970-01-05, a Monday, so ids and the random stream follow the week, not the load date. */
const weekNumber = (weekStart: string): number =>
  Math.round((Date.parse(`${weekStart}T00:00:00Z`) - Date.UTC(1970, 0, 5)) / (7 * DAY_MS));

/** Person `n`'s rows for one week: a main and a second outside project, overhead admin, and now and then leave. */
function rowsOf(n: number, week: number): Row[] {
  const next = lcg(n * 7919 + week);
  const assigned = demoAssigned(n);
  const outside = assigned.filter((p) => p.firm === null);
  const overhead = assigned.find((p) => p.firm !== null);
  const main = outside[(week + n) % outside.length];
  const second = outside[(week + n + 1) % outside.length];
  if (main === undefined || second === undefined || overhead === undefined) return [];
  const rows: Row[] = [
    { project: main, task: MAIN_TASKS[(week + n) % MAIN_TASKS.length] ?? 'DSGN', days: new Map() },
    {
      project: second,
      task: SECOND_TASKS[(week + 2 * n) % SECOND_TASKS.length] ?? 'MEET',
      days: new Map(),
    },
    { project: overhead, task: 'ADMN', days: new Map() },
  ];
  const leaveDay = (week + n) % 7 === 0 ? next() % 5 : -1;
  const leave: Row = { project: overhead, task: 'LEAV', days: new Map() };
  const dayTotal = n % 4 === 0 ? 750 : 800;
  for (const dow of WORKING_DAYS) {
    if (dow === leaveDay) {
      leave.days.set(dow, dayTotal);
      continue;
    }
    const admin = 25 * (2 + (next() % 3));
    const secondShare = 25 * (4 + (next() % 9));
    rows[2]?.days.set(dow, admin);
    if (next() % 4 !== 0) rows[1]?.days.set(dow, secondShare);
    const used = admin + (rows[1]?.days.get(dow) ?? 0);
    rows[0]?.days.set(dow, dayTotal - used);
  }
  return leave.days.size > 0 ? [...rows, leave] : rows;
}

const at = (weekStart: string, days: number, hour: number, minutes: number): number =>
  Date.parse(`${addDays(weekStart, days)}T00:00:00Z`) + hour * 3600000 + minutes * 60000;

/** The SQL for every demo person's thirteen weeks ending at `currentWeek`, notes sealed under `kek`. */
export async function demoWeekStatements(kek: string, currentWeek: string): Promise<string[]> {
  const sql: string[] = [];
  const people = demoPeople();
  for (let back = DEMO_WEEKS - 1; back >= 0; back--) {
    const weekStart = addDays(currentWeek, -7 * back);
    const week = weekNumber(weekStart);
    for (const [n, person] of people.entries()) {
      const state = demoState(n, back);
      const submittedAt = at(weekStart, 4, 16, 30 + n * 4);
      const rows = rowsOf(n, week);
      const rowValues: string[] = [];
      const entryValues: string[] = [];
      for (const [position, row] of rows.entries()) {
        const rowN = (n + 1) * 1_000_000 + week * 10 + position;
        const rowId = demoId('5f', rowN);
        rowValues.push(
          `('${rowId}', '${row.project.clientId}', '${person.id}', '${weekStart}', '${row.project.id}', '${taskId(row.task)}', ${String(position)})`,
        );
        for (const [dow, hundredths] of row.days) {
          const entryId = demoId('60', rowN * 10 + dow);
          const text = noteFor(row.task, n + week + dow + position);
          const sealed =
            text === null
              ? 'NULL, NULL, NULL'
              : await sealedSeedNote(kek, row.project.clientId, entryId, text);
          entryValues.push(
            `('${entryId}', '${row.project.clientId}', '${rowId}', ${String(dow)}, ${String(hundredths)}, ${sealed}, ${String(at(weekStart, dow, 17, n))})`,
          );
        }
      }
      sql.push(
        `INSERT OR IGNORE INTO week_row (id, client_id, person_id, week_start, project_id, task_code_id, position) VALUES ${rowValues.join(', ')};`,
        `INSERT OR IGNORE INTO entry (id, client_id, row_id, dow, hundredths, note_ct, note_iv, key_version, updated_at) VALUES ${entryValues.join(', ')};`,
      );
      if (state === null) continue;
      const own = DEMO_ACCOUNTANTS[firmOf(n)];
      const other = DEMO_ACCOUNTANTS[firmOf(n) === 0 ? 1 : 0];
      const decider = demoId('5c', (own === n ? other : own) + 1);
      const decided =
        state === 'submitted'
          ? 'NULL, NULL'
          : `'${decider}', ${String(at(weekStart, 7, 9, 30 + n * 3))}`;
      sql.push(
        `INSERT OR IGNORE INTO week_submission (person_id, week_start, state, submitted_at, decided_by, decided_at) VALUES ('${person.id}', '${weekStart}', '${state}', ${String(submittedAt)}, ${decided});`,
      );
    }
  }
  return sql;
}
