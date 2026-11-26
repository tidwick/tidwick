-- table pending_codes
-- The ten plain codes just made for a person, kept for ten minutes so a reload of the account page shows them
-- again; the person's acknowledgement deletes the row, and every write or read prunes expired rows. One row per
-- person; a new batch replaces it. Only the session that made the codes (session_hash) is shown them.
CREATE TABLE pending_codes (
  person_id TEXT PRIMARY KEY REFERENCES person (id),
  session_hash TEXT NOT NULL,
  codes TEXT NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
