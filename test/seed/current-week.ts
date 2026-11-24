// Ten rows of hours and notes for one member in a given week, so the dev database opens on a week with something in
// it. The member is the third person (Cora in the local sessions), assigned five projects; each takes two tasks.
import { bookableBy, SEED_IDS } from './build.ts';
import { sealedSeedNote } from './keys.ts';

export const MEMBER_INDEX = 2;
export const ROW_COUNT = 10;
const BOOKED_AT = Date.UTC(2026, 0, 5);

const NOTES = [
  'Reviewed the drawings with the site lead',
  'Call with the client about the schedule',
  'Updated the fixture list',
  'Walked the site and took measurements',
  'Prepared the revised sections',
  'Weekly team meeting',
];

/** The SQL that books ten rows in the week starting `weekStart` for the member, notes sealed under `kek`. */
export async function currentWeekStatements(weekStart: string, kek: string): Promise<string[]> {
  const person = SEED_IDS.person(MEMBER_INDEX + 1);
  const choices = bookableBy(MEMBER_INDEX).flatMap((b) =>
    b.taskIds.slice(0, 2).map((taskId) => ({ ...b, taskId })),
  );
  const sql: string[] = [];
  for (const [position, choice] of choices.slice(0, ROW_COUNT).entries()) {
    const tail = `${weekStart.replaceAll('-', '')}${String(position).padStart(3, '0')}`;
    const rowId = `e1000000-0000-4000-8000-${tail}0`;
    sql.push(
      `INSERT OR IGNORE INTO week_row (id, client_id, person_id, week_start, project_id, task_code_id, position) VALUES ('${rowId}', '${choice.clientId}', '${person}', '${weekStart}', '${choice.projectId}', '${choice.taskId}', ${String(position)});`,
    );
    for (const dow of [position % 5, (position + 2) % 5]) {
      const entryId = `f1000000-0000-4000-8000-${tail}${String(dow)}`;
      const hundredths = 150 + 50 * ((position + dow) % 4);
      const note = NOTES[(position + dow) % NOTES.length] ?? '';
      const sealed = await sealedSeedNote(kek, choice.clientId, entryId, note);
      sql.push(
        `INSERT OR IGNORE INTO entry (id, client_id, row_id, dow, hundredths, note_ct, note_iv, key_version, updated_at) VALUES ('${entryId}', '${choice.clientId}', '${rowId}', ${String(dow)}, ${String(hundredths)}, ${sealed}, ${String(BOOKED_AT)});`,
      );
    }
  }
  return sql;
}
