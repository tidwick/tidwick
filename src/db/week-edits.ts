// The audit view of a week: each edit an accounting admin made through the lock to a cell that still holds hours or
// a note, with the hours before and after and whether its note changed. The event records the note's ciphertext
// only, so the view can say the note changed and never what it said. A cell cleared through the lock has no entry
// left to name its week, so it is in the audit log but not listed here (ARCHITECTURE, Known limits).
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
  after: number;
  noteChanged: boolean;
}

interface EditRow {
  seq: number;
  at: number;
  editor: string | null;
  project: string;
  task: string;
  dow: number;
  before_json: string | null;
  after_json: string;
}

const EDITS = `SELECT a.seq, a.at, ed.name AS editor, p.name AS project, t.code AS task, e.dow, a.before_json, a.after_json
FROM week_row r
JOIN entry e ON e.client_id = r.client_id AND e.row_id = r.id
JOIN audit_event a ON a.target = 'entry:' || e.id AND a.action = 'entriesFor.save'
JOIN project p ON p.client_id = r.client_id AND p.id = r.project_id
JOIN task_code t ON t.id = r.task_code_id
LEFT JOIN person ed ON ed.id = a.actor_id
WHERE r.person_id = ?1 AND r.week_start = ?2 AND a.after_json IS NOT NULL
ORDER BY a.seq`;

interface Stored {
  hundredths: number;
  note_ct: string | null;
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
    const after = JSON.parse(row.after_json) as Stored;
    return {
      seq: row.seq,
      at: row.at,
      editor: row.editor,
      project: row.project,
      task: row.task,
      dow: row.dow,
      before: before === null ? null : before.hundredths,
      after: after.hundredths,
      noteChanged: (before?.note_ct ?? null) !== after.note_ct,
    };
  });
}
