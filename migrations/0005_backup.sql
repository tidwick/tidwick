CREATE TABLE backup_run (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  object_key TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  chain_seq INTEGER NOT NULL CHECK (chain_seq >= 0),
  chain_head TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'failed')),
  error TEXT
) STRICT;

CREATE INDEX backup_run_finished ON backup_run (finished_at);
