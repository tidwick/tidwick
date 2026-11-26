-- table pending_codes
-- The ten plain codes just made for a person, kept for ten minutes so a reload of the account page shows them
-- again; the person's acknowledgement deletes the row. One row per person; a new batch replaces it.
CREATE TABLE pending_codes (
  person_id TEXT PRIMARY KEY REFERENCES person (id),
  codes TEXT NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
