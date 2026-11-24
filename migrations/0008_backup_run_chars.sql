-- The characters of NDJSON a run built, so the 09:00 check can warn before a dump reaches the size ceiling.
-- Runs recorded before this column, and runs that failed before the dump was built, read 0.
ALTER TABLE backup_run ADD COLUMN chars INTEGER NOT NULL DEFAULT 0;
