-- The two tables pruned on every write get an index on the column the prune reads,
-- so a prune touches the rows it deletes and not the whole table.
CREATE INDEX auth_challenge_expires ON auth_challenge (expires_at);
CREATE INDEX recovery_attempt_failed ON recovery_attempt (failed_at);
