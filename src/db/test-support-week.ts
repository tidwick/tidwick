// Test support, never imported by production code. The seeded week written into a test D1 as approved time: the first 40 seeded people each get rows on projects
// they are assigned to, with sealed notes, hours clipped so no day passes 24. Returns the same entries as plain
// data, the independent side of every total a test compares.
import { seal } from './entry-writes';
import { keyRing } from './client-keys';
import { DAY_CAP } from '../lib/hours';
import { addDays } from '../lib/week';
import { SEED_IDS } from '../../test/seed/build';
import { loadSeed } from '../../test/seed/load';
import { seededWeek } from '../../test/seed/week';

const AT = Date.UTC(2026, 0, 5);

export interface SeededEntry {
  personId: string;
  personCode: string;
  clientId: string;
  projectNumber: string;
  taskCode: string;
  date: string;
  hundredths: number;
  note: string;
}

interface Assigned {
  client_id: string;
  project_id: string;
  number: string | null;
}

const group = <T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> => {
  const map = new Map<string, T[]>();
  for (const row of rows) map.set(key(row), [...(map.get(key(row)) ?? []), row]);
  return map;
};

async function run(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (let i = 0; i < statements.length; i += 100) await db.batch(statements.slice(i, i + 100));
}

export async function loadSeededWeek(
  db: D1Database,
  kek: string,
  weekStart: string,
): Promise<SeededEntry[]> {
  await loadSeed(db, kek);
  const people = (
    await db
      .prepare('SELECT id, external_code FROM person ORDER BY id LIMIT 40')
      .all<{ id: string; external_code: string }>()
  ).results;
  const assigned = group(
    (
      await db
        .prepare(
          `SELECT a.person_id AS pid, a.client_id, a.project_id, p.number
           FROM assignment a JOIN project p ON p.id = a.project_id ORDER BY a.project_id`,
        )
        .all<Assigned & { pid: string }>()
    ).results,
    (r) => r.pid,
  );
  const tasks = group(
    (
      await db
        .prepare(
          `SELECT pt.project_id, pt.task_code_id, t.code FROM project_task pt
           JOIN task_code t ON t.id = pt.task_code_id ORDER BY pt.task_code_id`,
        )
        .all<{ project_id: string; task_code_id: string; code: string }>()
    ).results,
    (r) => r.project_id,
  );
  const ring = keyRing(db, { current: kek, previous: null });
  const statements: D1PreparedStatement[] = [];
  const model: SeededEntry[] = [];
  for (const [p, week] of seededWeek(40).entries()) {
    const person = people[p];
    if (!person) continue;
    const projects = assigned.get(person.id) ?? [];
    const dayTotals = Array.from({ length: 7 }, () => 0);
    for (const [r, row] of week.rows.entries()) {
      const project = projects[r % projects.length];
      const options = tasks.get(project?.project_id ?? '') ?? [];
      const task = options[(p + r) % options.length];
      if (!project || !task) continue;
      const rowId = `seedrow-${String(p)}-${String(r)}`;
      statements.push(
        db
          .prepare(
            `INSERT INTO week_row (id, client_id, person_id, week_start, project_id, task_code_id, position)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
          )
          .bind(
            rowId,
            project.client_id,
            person.id,
            weekStart,
            project.project_id,
            task.task_code_id,
            r,
          ),
      );
      for (const [dow, cell] of row.cells.entries()) {
        const room = DAY_CAP - (dayTotals[dow] ?? 0);
        const hundredths = Math.min(cell.hundredths, room);
        if (hundredths === 0 && cell.note === '') continue;
        dayTotals[dow] = (dayTotals[dow] ?? 0) + hundredths;
        const id = `seedentry-${String(p)}-${String(r)}-${String(dow)}`;
        const [ct, iv, version] = await seal(ring, project.client_id, id, cell.note);
        statements.push(
          db
            .prepare(
              `INSERT INTO entry (id, client_id, row_id, dow, hundredths, note_ct, note_iv, key_version, updated_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
            )
            .bind(id, project.client_id, rowId, dow, hundredths, ct, iv, version, AT),
        );
        if (hundredths > 0) {
          model.push({
            personId: person.id,
            personCode: person.external_code,
            clientId: project.client_id,
            projectNumber: project.number ?? '',
            taskCode: task.code,
            date: addDays(weekStart, dow),
            hundredths,
            note: cell.note,
          });
        }
      }
    }
    statements.push(
      db
        .prepare(
          `INSERT INTO week_submission (person_id, week_start, state, submitted_at, decided_by, decided_at)
           VALUES (?1, ?2, 'approved', ?3, ?4, ?3)`,
        )
        .bind(person.id, weekStart, AT, SEED_IDS.person(2)),
    );
  }
  await run(db, statements);
  return model;
}
