-- Text a backup must carry byte for byte: quotes, line breaks, a control character, a backslash, SQL, non-ASCII.
-- The restore drill loads this after the seed and compares a digest of every table (scripts/restore-drill.ts).
INSERT INTO task_code (id, code, name, created_at) VALUES
  ('hostile-1', 'H-QUOTE', 'O''Brien''s ''''quoted'''' name', 1),
  ('hostile-2', 'H-LINES', 'one' || char(10) || 'two' || char(13) || char(10) || 'three' || char(9) || 'tab', 1),
  ('hostile-3', 'H-CTRL', 'nul' || char(1) || 'soh' || char(127) || 'del', 1),
  ('hostile-4', 'H-SQL', '''); DROP TABLE person; --', 1),
  ('hostile-5', 'H-UNI', 'caf' || char(233) || ' ' || char(26085) || char(26412) || ' ' || char(128512) || ' back\slash \n', 1);
