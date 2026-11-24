// The statements an import writes with. Each takes its rows as one JSON array parameter read by `json_each`, so a
// statement stays far inside D1's bound-parameter limit however many rows it carries.

/** Records the batch; a batch already stored under another mapping changes nothing, so the event rolls it back. */
export const UPSERT_BATCH = `INSERT INTO import_batch (id, actor_id, rows_read, entries_written, rejected_json, started_at, finished_at, mapping_hash)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7)
ON CONFLICT (id) DO UPDATE SET actor_id = excluded.actor_id, rows_read = excluded.rows_read,
  entries_written = import_batch.entries_written + excluded.entries_written,
  rejected_json = excluded.rejected_json, finished_at = excluded.finished_at
WHERE import_batch.mapping_hash = excluded.mapping_hash`;

export const INSERT_ASSIGNMENTS = `INSERT OR IGNORE INTO assignment (client_id, project_id, person_id, assigned_at)
SELECT p.client_id, p.id, j.value ->> '$.p', ?2 FROM json_each(?1) j JOIN project p ON p.id = j.value ->> '$.j'`;

export const INSERT_ROWS = `INSERT INTO week_row (id, client_id, person_id, week_start, project_id, task_code_id, position)
SELECT j.value ->> '$.id', j.value ->> '$.c', j.value ->> '$.p', j.value ->> '$.w', j.value ->> '$.j',
  j.value ->> '$.t', j.value ->> '$.n' FROM json_each(?1) j`;

export const INSERT_ENTRIES = `INSERT INTO entry (id, client_id, row_id, dow, hundredths, note_ct, note_iv, key_version, import_id, updated_at)
SELECT j.value ->> '$.id', j.value ->> '$.c', j.value ->> '$.r', j.value ->> '$.d', j.value ->> '$.h',
  unhex(j.value ->> '$.ct'), unhex(j.value ->> '$.iv'), j.value ->> '$.kv', ?2, ?3 FROM json_each(?1) j`;

export const INSERT_WEEKS = `INSERT INTO week_submission (person_id, week_start, state, submitted_at, decided_by, decided_at)
SELECT j.value ->> '$.p', j.value ->> '$.w', 'approved', ?2, ?3, ?2 FROM json_each(?1) j WHERE true
ON CONFLICT DO NOTHING`;

/**
 * Fails NOT NULL, so the batch rolls back and the apply plans again, when a week the import writes into no longer
 * has the submission state it was planned against: an owner's submit landing after the plan cannot let the
 * import's hours into a submitted week.
 */
export const WEEKS_UNCHANGED = `INSERT INTO week_submission (person_id, week_start, state, submitted_at)
SELECT j.value ->> '$.p', j.value ->> '$.w', NULL, 0 FROM json_each(?1) j
WHERE (SELECT s.state FROM week_submission s
  WHERE s.person_id = j.value ->> '$.p' AND s.week_start = j.value ->> '$.w') IS NOT (j.value ->> '$.s')`;

/**
 * Fails NOT NULL, so the batch rolls back and the apply plans again, when a week the import would approve now
 * holds an entry it did not write: an owner's save landing after the plan cannot be approved with the import.
 */
export const WEEKS_IMPORT_ONLY = `INSERT INTO week_submission (person_id, week_start, state, submitted_at)
SELECT j.value ->> '$.p', j.value ->> '$.w', NULL, 0 FROM json_each(?1) j
WHERE EXISTS (SELECT 1 FROM entry e JOIN week_row r ON r.client_id = e.client_id AND r.id = e.row_id
  WHERE r.person_id = j.value ->> '$.p' AND r.week_start = j.value ->> '$.w' AND e.import_id IS NOT ?2)`;

/**
 * Fails NOT NULL, so the batch rolls back and the apply plans again, when an assignment the plan counted as new now
 * exists or one it counted as held is gone, so the event's list of assignments added is exact.
 */
export const ASSIGNMENTS_UNCHANGED = `INSERT INTO assignment (client_id, project_id, person_id, assigned_at)
SELECT NULL, NULL, NULL, 0 FROM json_each(?1) j
WHERE EXISTS (SELECT 1 FROM assignment a
  WHERE a.person_id = j.value ->> '$.p' AND a.project_id = j.value ->> '$.j') = (j.value ->> '$.n')`;

// Under D1's 100 KB statement length even if a platform counts bound values toward it.
const CHUNK_BYTES = 90_000;

/** Rows as JSON arrays each under about 90 KB, so one statement's parameter stays small. */
export function chunkJson(items: readonly object[]): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 2;
  for (const item of items) {
    const text = JSON.stringify(item);
    if (current.length > 0 && size + text.length + 1 > CHUNK_BYTES) {
      chunks.push(`[${current.join(',')}]`);
      current = [];
      size = 2;
    }
    current.push(text);
    size += text.length + 1;
  }
  if (current.length > 0) chunks.push(`[${current.join(',')}]`);
  return chunks;
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
