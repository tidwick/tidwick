-- One row in each kept table the seed leaves empty (and a leaver and a returned week), so the restore drill proves they survive a dump and a load
-- (scripts/restore-drill.ts fails on a kept table with no source rows). Fixed ids, invented values, no secrets.
INSERT INTO person (id, firm_id, email, name, external_code, created_at, offboarded_at) VALUES
  ('a1000000-0000-4000-8000-000000000101', 'f1000000-0000-4000-8000-000000000001', 'leaver.example@larkspur.example', 'Leaver Example', 'R2001', 1, 1700000000000);
INSERT INTO credential (id, person_id, public_key, counter, transports, created_at, last_used_at, revoked_at) VALUES
  ('kept-credential-1', 'a1000000-0000-4000-8000-000000000005', X'00FF10AB80C3', 7, '["internal","hybrid"]', 1, 2, NULL);
INSERT INTO recovery_code (person_id, code_hash, created_at, used_at) VALUES
  ('a1000000-0000-4000-8000-000000000005', 'kept-code-hash-1', 1, NULL);
INSERT INTO person_identity (id, person_id, provider, issuer, subject, email, created_at, last_used_at, revoked_at) VALUES
  ('kept-identity-1', 'a1000000-0000-4000-8000-000000000005', 'example', 'https://idp.example/kept', 'kept-subject-1', 'kept.example@larkspur.example', 1, 2, NULL);
INSERT INTO enrolment (token_hash, person_id, expires_at, used_at) VALUES
  ('kept-token-hash-1', 'a1000000-0000-4000-8000-000000000005', 4102444800000, NULL);
INSERT INTO import_batch (id, actor_id, rows_read, entries_written, rejected_json, started_at, finished_at, mapping_hash) VALUES
  ('kept-batch-1', 'a1000000-0000-4000-8000-000000000001', 3, 2, '[{"row":3,"why":"unknown project"}]', 1, 2, 'kept-mapping-hash-1');
INSERT INTO week_submission (person_id, week_start, state, submitted_at, decided_by, decided_at, return_reason) VALUES
  ('a1000000-0000-4000-8000-000000000005', '2025-12-01', 'returned', 1, 'a1000000-0000-4000-8000-000000000002', 2, 'Please split the 3h block across both projects.');
INSERT INTO week_row (id, client_id, person_id, week_start, project_id, task_code_id, position)
  SELECT 'kept-row-1', client_id, 'a1000000-0000-4000-8000-000000000005', '2025-12-01', project_id, task_code_id, 0
  FROM project_task ORDER BY project_id, task_code_id LIMIT 1;
INSERT INTO entry (id, client_id, row_id, dow, hundredths, updated_at)
  SELECT 'kept-entry-1', client_id, id, 0, 150, 1 FROM week_row WHERE id = 'kept-row-1';
