// What an export reads: one client's approved entries in a range with their notes opened, and, for the export
// page, each client's approved hours and how many person-weeks in the range are not approved yet. All-clients
// scope only: a file leaving is an accounting admin's act.
import { fail } from '../lib/errors';
import type { DateRange } from '../lib/date-range';
import type { ExportEntry } from '../lib/export';
import { exportBytes, MAX_EXPORT_BYTES, MAX_EXPORT_ROWS } from '../lib/limits';
import type { NoteKeks } from '../lib/note-crypto';
import { keyRing } from './client-keys';
import type { Scope } from './scope';
import { openCell } from './week-view';

interface EntryRecord {
  id: string;
  row_id: string;
  client_id: string;
  dow: number;
  hundredths: number;
  note_ct: ArrayBuffer | number[] | null;
  note_iv: ArrayBuffer | number[] | null;
  key_version: number | null;
  day: string;
  week_start: string;
  person_name: string;
  person_email: string;
  person_code: string | null;
  client_name: string;
  project_number: string | null;
  project_name: string;
  task_code: string;
  task_name: string;
}

const DAY = "date(r.week_start, '+' || e.dow || ' days')";

const APPROVED_FROM = `FROM entry e
JOIN week_row r ON r.client_id = e.client_id AND r.id = e.row_id
JOIN week_submission s ON s.person_id = r.person_id AND s.week_start = r.week_start AND s.state = 'approved'
JOIN person p ON p.id = r.person_id
JOIN client c ON c.id = r.client_id
JOIN project pr ON pr.client_id = r.client_id AND pr.id = r.project_id
JOIN task_code t ON t.id = r.task_code_id
WHERE r.client_id = ?1 AND ${DAY} BETWEEN ?2 AND ?3 AND e.hundredths > 0`;

const APPROVED_COUNT = `SELECT count(*) AS n, coalesce(sum(length(e.note_ct)), 0) AS note_bytes ${APPROVED_FROM}`;

const APPROVED_ENTRIES = `SELECT e.id, e.row_id, e.client_id, e.dow, e.hundredths, e.note_ct, e.note_iv, e.key_version,
  ${DAY} AS day, r.week_start, p.name AS person_name, p.email AS person_email, p.external_code AS person_code,
  c.name AS client_name, pr.number AS project_number, pr.name AS project_name, t.code AS task_code, t.name AS task_name
${APPROVED_FROM}
ORDER BY ${DAY}, p.name, p.id, r.position, r.id`;

export interface ExportCap {
  rows: number;
  bytes: number;
}

const EXPORT_CAP: ExportCap = { rows: MAX_EXPORT_ROWS, bytes: MAX_EXPORT_BYTES };

/**
 * The client's approved entries with hours in the range, oldest day first, each note opened under the client's
 * key. The rows are held whole in memory, so a range with more than `cap.rows` of them, or whose rows and note
 * ciphertext are estimated above `cap.bytes`, is refused before any is read (ADR 0010).
 */
export async function approvedEntries(
  scope: Scope,
  db: D1Database,
  keks: NoteKeks,
  clientId: string,
  range: DateRange,
  cap: ExportCap = EXPORT_CAP,
): Promise<ExportEntry[]> {
  if (scope.kind !== 'all') fail('forbidden');
  const count = await db
    .prepare(APPROVED_COUNT)
    .bind(clientId, range.from, range.to)
    .first<{ n: number; note_bytes: number }>();
  const held = count?.n ?? 0;
  if (held > cap.rows) {
    fail(
      'invalid_input',
      `this range holds ${String(held)} approved entries for the client and one file holds at most ${String(cap.rows)}; choose a shorter range`,
    );
  }
  if (exportBytes(held, count?.note_bytes ?? 0) > cap.bytes) {
    fail(
      'invalid_input',
      `this range holds ${String(held)} approved entries for the client whose notes are too long to build as one file; choose a shorter range`,
    );
  }
  const found = await db
    .prepare(APPROVED_ENTRIES)
    .bind(clientId, range.from, range.to)
    .all<EntryRecord>();
  const ring = keyRing(db, keks);
  const entries: ExportEntry[] = [];
  for (const r of found.results) {
    const { note } = await openCell(r, ring);
    entries.push({
      date: r.day,
      weekStart: r.week_start,
      personName: r.person_name,
      personEmail: r.person_email,
      personCode: r.person_code,
      clientName: r.client_name,
      projectNumber: r.project_number,
      projectName: r.project_name,
      taskCode: r.task_code,
      taskName: r.task_name,
      hundredths: r.hundredths,
      note,
    });
  }
  return entries;
}

export interface ClientExportSummary {
  client_id: string;
  name: string;
  approved_hundredths: number;
  unapproved_weeks: number;
}

const SUMMARY = `SELECT c.id AS client_id, c.name,
  coalesce(sum(CASE WHEN s.state = 'approved' THEN e.hundredths END), 0) AS approved_hundredths,
  count(DISTINCT CASE WHEN coalesce(s.state, 'draft') <> 'approved' THEN r.person_id || '|' || r.week_start END) AS unapproved_weeks
FROM client c
JOIN week_row r ON r.client_id = c.id
JOIN entry e ON e.client_id = r.client_id AND e.row_id = r.id AND e.hundredths > 0
LEFT JOIN week_submission s ON s.person_id = r.person_id AND s.week_start = r.week_start
WHERE ${DAY} BETWEEN ?1 AND ?2
GROUP BY c.id, c.name
ORDER BY c.name`;

/** Every client with hours in the range: approved hours, and person-weeks still waiting for approval. */
export async function exportSummary(
  scope: Scope,
  db: D1Database,
  range: DateRange,
): Promise<ClientExportSummary[]> {
  if (scope.kind !== 'all') fail('forbidden');
  const found = await db.prepare(SUMMARY).bind(range.from, range.to).all<ClientExportSummary>();
  return found.results;
}
