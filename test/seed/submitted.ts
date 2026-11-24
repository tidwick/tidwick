// Weeks that people have already submitted, so the approvals list opens with someone to approve. Each submitter
// books two rows with eight hours Monday to Thursday and four on Friday, and submits late on the Friday of the
// week itself, so the list never shows a week submitted before it began.
import { bookableBy, SEED_IDS } from './build.ts';

/** The people in the seed who are not a fixture session (the first three are the admin, the accountant and the member). */
export const FIRST_SUBMITTER = 3;
export const ROWS_EACH = 2;
/** Eight hours on four days and four on the fifth, in hundredths, per row. */
export const ROW_HUNDREDTHS = 3600;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOURS = [800, 800, 800, 800, 400];

/** When the person at `offset` submits the week starting `weekStart`: Friday from 17:00 UTC, a few minutes apart. */
export function submittedAt(weekStart: string, offset: number): number {
  return Date.parse(`${weekStart}T17:00:00Z`) + 4 * DAY_MS + offset * 7 * 60 * 1000;
}

/** The SQL that submits the week starting `weekStart` for `count` people from the first submitter on. */
export function submittedStatements(weekStart: string, count: number): string[] {
  const code = weekStart.replaceAll('-', '').slice(2);
  const sql: string[] = [];
  for (let offset = 0; offset < count; offset++) {
    const index = FIRST_SUBMITTER + offset;
    const person = SEED_IDS.person(index + 1);
    const tail = `${code}${String(index).padStart(3, '0')}`;
    for (const [row, choice] of bookableBy(index).slice(0, ROWS_EACH).entries()) {
      const rowId = `e2000000-0000-4000-8000-${tail}${String(row)}0`;
      const task = choice.taskIds[0] ?? '';
      sql.push(
        `INSERT OR IGNORE INTO week_row (id, client_id, person_id, week_start, project_id, task_code_id, position) VALUES ('${rowId}', '${choice.clientId}', '${person}', '${weekStart}', '${choice.projectId}', '${task}', ${String(row)});`,
      );
      for (const [dow, hundredths] of HOURS.entries()) {
        const entryId = `f2000000-0000-4000-8000-${tail}${String(row)}${String(dow)}`;
        sql.push(
          `INSERT OR IGNORE INTO entry (id, client_id, row_id, dow, hundredths, updated_at) VALUES ('${entryId}', '${choice.clientId}', '${rowId}', ${String(dow)}, ${String(hundredths)}, ${String(submittedAt(weekStart, offset))});`,
        );
      }
    }
    sql.push(
      `INSERT OR IGNORE INTO week_submission (person_id, week_start, state, submitted_at) VALUES ('${person}', '${weekStart}', 'submitted', ${String(submittedAt(weekStart, offset))});`,
    );
  }
  return sql;
}
