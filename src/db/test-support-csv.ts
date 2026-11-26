// Counts and staged state for the export, report and import tests, which share one database per file. Production
// code never imports this module.

const COUNTS = {
  entries: 'SELECT count(*) AS n FROM entry',
  importedEntries: 'SELECT count(*) AS n FROM entry WHERE import_id IS NOT NULL',
  entriesOfImport: 'SELECT count(*) AS n FROM entry WHERE import_id = ?1',
  hundredthsOfImport: 'SELECT sum(hundredths) AS n FROM entry WHERE import_id = ?1',
  clients: 'SELECT count(*) AS n FROM client',
  projects: 'SELECT count(*) AS n FROM project',
  clientsNamed: 'SELECT count(*) AS n FROM client WHERE name = ?1',
  importBatches: 'SELECT count(*) AS n FROM import_batch',
  importBatchEntries: 'SELECT entries_written AS n FROM import_batch',
  approvedWeeksOfPrefix: `SELECT count(*) AS n FROM week_submission WHERE state = 'approved' AND person_id LIKE ?1`,
  bookedPeopleApproved: `SELECT count(DISTINCT r.person_id) AS n FROM week_row r WHERE r.week_start = ?1
    AND EXISTS (SELECT 1 FROM week_submission s WHERE s.person_id = r.person_id AND s.week_start = r.week_start AND s.state = 'approved')`,
  bookedPeopleSubmitted: `SELECT count(DISTINCT r.person_id) AS n FROM week_row r WHERE r.week_start = ?1
    AND EXISTS (SELECT 1 FROM week_submission s WHERE s.person_id = r.person_id AND s.week_start = r.week_start AND s.state = 'submitted')`,
  bookedPeopleDraft: `SELECT count(DISTINCT r.person_id) AS n FROM week_row r WHERE r.week_start = ?1
    AND NOT EXISTS (SELECT 1 FROM week_submission s WHERE s.person_id = r.person_id AND s.week_start = r.week_start)`,
} as const;

export async function countOf(
  db: D1Database,
  what: keyof typeof COUNTS,
  ...args: string[]
): Promise<number> {
  const row = await db
    .prepare(COUNTS[what])
    .bind(...args)
    .first<{ n: number }>();
  return row?.n ?? -1;
}

export async function onlyImportBatchId(db: D1Database): Promise<string> {
  const row = await db.prepare('SELECT id FROM import_batch').first<{ id: string }>();
  return row?.id ?? '';
}

export async function projectIdNamed(db: D1Database, name: string): Promise<string> {
  const row = await db
    .prepare('SELECT id FROM project WHERE name = ?1')
    .bind(name)
    .first<{ id: string }>();
  return row?.id ?? '';
}

/** Puts a person's week into a state without the Actions, to stage what an export or report reads. */
export async function stampSubmission(
  db: D1Database,
  personId: string,
  weekStart: string,
  state: 'submitted' | 'approved' | 'returned',
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO week_submission (person_id, week_start, state, submitted_at) VALUES (?1, ?2, ?3, 1)',
    )
    .bind(personId, weekStart, state)
    .run();
}

/** Renames a client, to stage a name that holds markup or a formula. */
export async function renameClient(db: D1Database, clientId: string, name: string): Promise<void> {
  await db.prepare('UPDATE client SET name = ?1 WHERE id = ?2').bind(name, clientId).run();
}

export async function clientNameOf(db: D1Database, clientId: string): Promise<string> {
  const row = await db
    .prepare('SELECT name FROM client WHERE id = ?1')
    .bind(clientId)
    .first<{ name: string }>();
  return row?.name ?? '';
}

/** The text a report prints for a person, project and task code. */
export async function reportLabels(
  db: D1Database,
  ids: { personId: string; projectId: string; taskId: string },
): Promise<{ email: string; project: string; code: string; task: string }> {
  const row = await db
    .prepare(
      `SELECT p.email, pr.name AS project, t.code, t.name AS task
       FROM person p, project pr, task_code t WHERE p.id = ?1 AND pr.id = ?2 AND t.id = ?3`,
    )
    .bind(ids.personId, ids.projectId, ids.taskId)
    .first<{ email: string; project: string; code: string; task: string }>();
  return row ?? { email: '', project: '', code: '', task: '' };
}
