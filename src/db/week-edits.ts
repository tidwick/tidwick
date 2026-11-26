// The audit view of a week: each edit an accounting admin made through the lock to a cell that still holds hours or
// a note, with the hours before and after and whether its note changed. The event records the note's ciphertext
// only, so the view can say the note changed and never what it said. The event names its row and day, so a cell
// cleared through the lock, whose entry is gone, is listed too, with no hours after.
import { fail } from '../lib/errors';
import type { Scope } from './scope';

export interface WeekEdit {
  seq: number;
  at: number;
  /** The accounting admin who saved it; null once that person is gone from the table. */
  editor: string | null;
  project: string;
  task: string;
  /** 0 is Monday. */
  dow: number;
  /** Hundredths before the edit, null when the edit created the cell. */
  before: number | null;
  /** Hundredths after the edit, null when the edit cleared the cell. */
  after: number | null;
  noteChanged: boolean;
}

interface EditRow {
  seq: number;
  at: number;
  editor: string | null;
  project: string;
  task: string;
  before_json: string | null;
  after_json: string | null;
}

const EDITS = `SELECT a.seq, a.at, ed.name AS editor, p.name AS project, t.code AS task, a.before_json, a.after_json
FROM week_row r
JOIN audit_event a ON a.action = 'entriesFor.save'
  AND r.id = json_extract(coalesce(a.after_json, a.before_json), '$.row')
JOIN project p ON p.client_id = r.client_id AND p.id = r.project_id
JOIN task_code t ON t.id = r.task_code_id
LEFT JOIN person ed ON ed.id = a.actor_id
WHERE r.person_id = ?1 AND r.week_start = ?2
ORDER BY a.seq`;

interface Stored {
  hundredths: number;
  note_ct: string | null;
  dow: number;
}

/** Edits to one person's week through the lock, oldest first. Only an all-clients scope reads them. */
export async function editsOfWeek(
  scope: Scope,
  db: D1Database,
  personId: string,
  weekStart: string,
): Promise<WeekEdit[]> {
  if (scope.kind !== 'all') fail('not_found');
  const found = await db.prepare(EDITS).bind(personId, weekStart).all<EditRow>();
  return found.results.map((row) => {
    const before = row.before_json === null ? null : (JSON.parse(row.before_json) as Stored);
    const after = row.after_json === null ? null : (JSON.parse(row.after_json) as Stored);
    const cell = after ?? before;
    return {
      seq: row.seq,
      at: row.at,
      editor: row.editor,
      project: row.project,
      task: row.task,
      dow: cell?.dow ?? 0,
      before: before === null ? null : before.hundredths,
      after: after === null ? null : after.hundredths,
      noteChanged: (before?.note_ct ?? null) !== (after?.note_ct ?? null),
    };
  });
}
