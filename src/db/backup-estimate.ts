// An estimate of the characters one backup would hold, read from the live tables, for the operator's watch query
// in docs/ARCHITECTURE.md. It is one D1 statement and needs no backup. Each constant is the width of a backup
// line with every column null, measured with `encodeLine`, and each column adds its own length, so the figure
// follows the real id and note lengths and lands within about 15% of what `ndjson()` counts. No imports but the
// cap, so the operator can run it as-is.
import { BACKUP_DUMP_CHARS } from '../lib/limits.ts';

// Written with `char(34)`, the quote, and no quote of its own, so the statement sits inside single quotes in a
// shell. A JSON text stored in a column is escaped inside the line, one more character for each quote it holds.
const ESCAPED = (column: string): string =>
  `coalesce(length(replace(${column}, char(34), char(34) || char(34))), 2)`;

const lengths = (columns: string): string =>
  columns
    .split(' ')
    .map((c) => `length(${c})`)
    .join(' + ');

const ENTRY_LENGTHS = lengths('id client_id row_id dow hundredths updated_at');
const WEEK_ROW_LENGTHS = lengths('id client_id person_id project_id task_code_id position');
const SUBMISSION_LENGTHS = lengths('person_id state submitted_at');
const AUDIT_LENGTHS = lengths('seq at action target');
const BEFORE_ESCAPED = ESCAPED('before_json');
const AFTER_ESCAPED = ESCAPED('after_json');

// A blob is hex, so two characters a byte; a note adds its ciphertext, its nonce and its key version.
const ENTRY = `SELECT coalesce(sum(156 + ${ENTRY_LENGTHS} + coalesce(CASE WHEN note_ct IS NULL THEN 0 ELSE 2 * (length(note_ct) + length(note_iv)) + 4 + length(key_version) END, 0) + coalesce(length(import_id) - 2, 0)), 0) FROM entry`;

const WEEK_ROW = `SELECT coalesce(sum(133 + ${WEEK_ROW_LENGTHS}), 0) FROM week_row`;

const WEEK_SUBMISSION = `SELECT coalesce(sum(164 + ${SUBMISSION_LENGTHS} + coalesce(2 * length(return_reason) + 2, 0) + coalesce(length(decided_by) - 2, 0) + coalesce(length(decided_at) - 4, 0)), 0) FROM week_submission`;

const AUDIT_EVENT = `SELECT coalesce(sum(286 + ${AUDIT_LENGTHS} + coalesce(length(actor_id) - 2, 0) + coalesce(length(client_id) - 2, 0) + ${BEFORE_ESCAPED} - 2 + ${AFTER_ESCAPED} - 2), 0) FROM audit_event`;

// The other kept tables are small and bounded by the roster, so each row counts a flat width.
const OTHER_TABLES = [
  'client',
  'client_key',
  'firm',
  'person',
  'person_role',
  'credential',
  'enrolment',
  'recovery_code',
  'task_code',
  'project',
  'project_task',
  'assignment',
  'import_batch',
  'setting',
  'backup_run',
];
const OTHER_WIDTH = '250';
const OTHER = OTHER_TABLES.map((t) => ['(SELECT count(*) FROM', t, ')'].join(' ')).join(' + ');
const CAP = String(BACKUP_DUMP_CHARS);

/**
 * One statement: the estimated characters of a backup and that as a percentage of the cap. An operator runs it
 * against the live D1; when `percent_of_cap` passes `BACKUP_WARN_PERCENT`, plan the streaming backup before the estimate reaches 100.
 */
export const ESTIMATE_SQL = `SELECT chars, chars * 100 / ${CAP} AS percent_of_cap FROM (SELECT
  (${ENTRY}) +
  (${WEEK_ROW}) +
  (${WEEK_SUBMISSION}) +
  (${AUDIT_EVENT}) +
  ${OTHER_WIDTH} * (${OTHER}) AS chars)`;

/** The estimate as numbers. */
export async function estimateBackup(
  db: D1Database,
): Promise<{ chars: number; percent_of_cap: number }> {
  const row = await db.prepare(ESTIMATE_SQL).first<{ chars: number; percent_of_cap: number }>();
  return row ?? { chars: 0, percent_of_cap: 0 };
}
