-- When each recovery counter last failed, so counters for emails nobody has tried in a day can be pruned.
-- Rows already stored read 0 and are pruned on the next failure anywhere, unless still locked.
ALTER TABLE recovery_attempt ADD COLUMN failed_at INTEGER NOT NULL DEFAULT 0;
