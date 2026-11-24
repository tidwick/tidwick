// Entry reads through the scope.
import { projectsParam, requirePersonVisible, type Scope } from './scope';

export interface EntryRow {
  id: string;
  client_id: string;
  row_id: string;
  person_id: string;
  week_start: string;
  project_id: string;
  task_code_id: string;
  dow: number;
  hundredths: number;
  has_note: number;
}

const ENTRIES_OF_WEEK = `SELECT e.id, e.client_id, e.row_id, r.person_id, r.week_start, r.project_id,
  r.task_code_id, e.dow, e.hundredths, e.note_ct IS NOT NULL AS has_note
FROM entry e
JOIN week_row r ON r.client_id = e.client_id AND r.id = e.row_id
WHERE r.person_id = ?1 AND r.week_start = ?2
  AND (?3 IS NULL OR r.project_id IN (SELECT value FROM json_each(?3)))
ORDER BY r.position, r.id, e.dow`;

/** One person's entries for a week, limited to the scope's projects; a member asking for another person gets 404. */
export async function entriesOfWeek(
  scope: Scope,
  db: D1Database,
  personId: string,
  weekStart: string,
): Promise<EntryRow[]> {
  requirePersonVisible(scope, personId);
  const result = await db
    .prepare(ENTRIES_OF_WEEK)
    .bind(personId, weekStart, projectsParam(scope))
    .all<EntryRow>();
  return result.results;
}
