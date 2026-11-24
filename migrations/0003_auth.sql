-- Passkeys, enrolment links, recovery codes, ceremony challenges and sessions. Every token, code,
-- challenge id, session id and email used as a key is stored only as an HMAC under SESSION_SECRET.
CREATE TABLE credential (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES person (id),
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL CHECK (counter >= 0),
  transports TEXT NOT NULL CHECK (json_valid(transports)),
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
) STRICT;

CREATE INDEX credential_person ON credential (person_id);

CREATE TABLE enrolment (
  token_hash TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES person (id),
  expires_at INTEGER NOT NULL,
  used_at INTEGER
) STRICT;

CREATE INDEX enrolment_person ON enrolment (person_id);

CREATE TABLE recovery_code (
  person_id TEXT NOT NULL REFERENCES person (id),
  code_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  used_at INTEGER,
  PRIMARY KEY (person_id, code_hash)
) STRICT;

CREATE TABLE recovery_attempt (
  email_hash TEXT PRIMARY KEY,
  failures INTEGER NOT NULL CHECK (failures >= 0),
  locked_until INTEGER
) STRICT;

CREATE TABLE auth_challenge (
  id_hash TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('enrol', 'login', 'step_up', 'add')),
  person_id TEXT REFERENCES person (id),
  challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
) STRICT;

CREATE TABLE session (
  id_hash TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES person (id),
  created_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  step_up_at INTEGER NOT NULL,
  must_enrol INTEGER NOT NULL CHECK (must_enrol IN (0, 1)),
  revoked_at INTEGER
) STRICT;

CREATE INDEX session_person ON session (person_id);
