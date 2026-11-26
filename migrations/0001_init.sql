-- The v0.1.0 schema: the pre-release migrations 0001-0011 squashed into one file.

-- table agent_grant
CREATE TABLE agent_grant (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES person (id),
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  scopes TEXT NOT NULL CHECK (json_valid(scopes)),
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
) STRICT;

-- table agent_token
CREATE TABLE agent_token (
  hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES agent_grant (id),
  kind TEXT NOT NULL CHECK (kind IN ('code', 'access', 'refresh')),
  expires_at INTEGER NOT NULL
) STRICT;

-- table assignment
CREATE TABLE assignment (
  client_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES person (id),
  assigned_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, person_id),
  FOREIGN KEY (client_id, project_id) REFERENCES project (client_id, id)
) STRICT;

-- table audit_event
CREATE TABLE "audit_event" (
  seq INTEGER PRIMARY KEY CHECK (seq > 0),
  at INTEGER NOT NULL,
  actor_id TEXT REFERENCES person (id),
  action TEXT NOT NULL,
  client_id TEXT REFERENCES client (id),
  target TEXT NOT NULL,
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE
) STRICT;

-- table auth_challenge
CREATE TABLE auth_challenge (
  id_hash TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('enrol', 'login', 'step_up', 'add')),
  person_id TEXT REFERENCES person (id),
  challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
) STRICT;

-- table backup_run
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
, chars INTEGER NOT NULL DEFAULT 0) STRICT;

-- table client
CREATE TABLE client (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at INTEGER NOT NULL,
  archived_at INTEGER,
  erased_at INTEGER
) STRICT;

-- table client_key
CREATE TABLE client_key (
  client_id TEXT NOT NULL REFERENCES client (id),
  version INTEGER NOT NULL CHECK (version > 0),
  wrapped BLOB,
  iv BLOB,
  kek_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  destroyed_at INTEGER,
  PRIMARY KEY (client_id, version),
  CHECK ((wrapped IS NULL) = (destroyed_at IS NOT NULL)),
  CHECK ((wrapped IS NULL) = (iv IS NULL))
) STRICT;

-- table credential
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

-- table enrolment
CREATE TABLE enrolment (
  token_hash TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES person (id),
  expires_at INTEGER NOT NULL,
  used_at INTEGER
) STRICT;

-- table entry
CREATE TABLE entry (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  row_id TEXT NOT NULL,
  dow INTEGER NOT NULL CHECK (dow BETWEEN 0 AND 6),
  hundredths INTEGER NOT NULL CHECK (hundredths BETWEEN 0 AND 2400),
  note_ct BLOB,
  note_iv BLOB,
  key_version INTEGER,
  import_id TEXT REFERENCES import_batch (id),
  updated_at INTEGER NOT NULL,
  UNIQUE (row_id, dow),
  FOREIGN KEY (client_id, row_id) REFERENCES week_row (client_id, id),
  FOREIGN KEY (client_id, key_version) REFERENCES client_key (client_id, version),
  CHECK (hundredths > 0 OR note_ct IS NOT NULL),
  CHECK ((note_ct IS NULL) = (note_iv IS NULL) AND (note_ct IS NULL) = (key_version IS NULL))
) STRICT;

-- table firm
CREATE TABLE firm (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE REFERENCES client (id)
) STRICT;

-- table import_batch
CREATE TABLE import_batch (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES person (id),
  rows_read INTEGER NOT NULL CHECK (rows_read >= 0),
  entries_written INTEGER NOT NULL CHECK (entries_written >= 0),
  rejected_json TEXT NOT NULL CHECK (json_valid(rejected_json)),
  started_at INTEGER NOT NULL,
  finished_at INTEGER
, mapping_hash TEXT NOT NULL DEFAULT '') STRICT;

-- table oidc_flow
CREATE TABLE oidc_flow (
  id_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('login', 'enrol', 'step_up', 'link')),
  person_id TEXT REFERENCES person (id),
  session_hash TEXT,
  enrol_hash TEXT,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  return_to TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
) STRICT;

-- table person
CREATE TABLE person (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firm (id),
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  external_code TEXT,
  created_at INTEGER NOT NULL,
  offboarded_at INTEGER
) STRICT;

-- table person_identity
CREATE TABLE person_identity (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES person (id),
  provider TEXT NOT NULL,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  email TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
) STRICT;

-- table person_role
CREATE TABLE person_role (
  person_id TEXT NOT NULL REFERENCES person (id),
  role TEXT NOT NULL CHECK (role IN ('accounting_admin', 'admin')),
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (person_id, role)
) STRICT;

-- table project
CREATE TABLE project (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES client (id),
  name TEXT NOT NULL,
  number TEXT CHECK (number GLOB '[0-9][0-9]-[0-9][0-9][0-9][0-9]'),
  created_at INTEGER NOT NULL,
  archived_at INTEGER,
  UNIQUE (client_id, id),
  UNIQUE (client_id, name COLLATE NOCASE)
) STRICT;

-- table project_task
CREATE TABLE project_task (
  client_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  task_code_id TEXT NOT NULL REFERENCES task_code (id),
  archived_at INTEGER,
  PRIMARY KEY (client_id, project_id, task_code_id),
  FOREIGN KEY (client_id, project_id) REFERENCES project (client_id, id)
) STRICT;

-- table recovery_attempt
CREATE TABLE recovery_attempt (
  email_hash TEXT PRIMARY KEY,
  failures INTEGER NOT NULL CHECK (failures >= 0),
  locked_until INTEGER
, failed_at INTEGER NOT NULL DEFAULT 0) STRICT;

-- table recovery_code
CREATE TABLE recovery_code (
  person_id TEXT NOT NULL REFERENCES person (id),
  code_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  used_at INTEGER,
  PRIMARY KEY (person_id, code_hash)
) STRICT;

-- table session
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

-- table setting
CREATE TABLE setting (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK (json_valid(value_json))
) STRICT;

-- table task_code
CREATE TABLE task_code (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  archived_at INTEGER
) STRICT;

-- table week_row
CREATE TABLE week_row (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES person (id),
  week_start TEXT NOT NULL CHECK (date(week_start) IS week_start AND strftime('%w', week_start) = '1'),
  project_id TEXT NOT NULL,
  task_code_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  UNIQUE (person_id, week_start, project_id, task_code_id),
  UNIQUE (client_id, id),
  FOREIGN KEY (client_id, project_id, task_code_id) REFERENCES project_task (client_id, project_id, task_code_id)
) STRICT;

-- table week_submission
CREATE TABLE week_submission (
  person_id TEXT NOT NULL REFERENCES person (id),
  week_start TEXT NOT NULL CHECK (date(week_start) IS week_start AND strftime('%w', week_start) = '1'),
  state TEXT NOT NULL CHECK (state IN ('submitted', 'approved', 'returned')),
  submitted_at INTEGER NOT NULL,
  decided_by TEXT REFERENCES person (id),
  decided_at INTEGER,
  PRIMARY KEY (person_id, week_start)
) STRICT;

-- index agent_grant_person
CREATE INDEX agent_grant_person ON agent_grant (person_id);

-- index agent_token_grant
CREATE INDEX agent_token_grant ON agent_token (grant_id);

-- index assignment_person
CREATE INDEX assignment_person ON assignment (person_id);

-- index audit_event_actor_seq
CREATE INDEX audit_event_actor_seq ON audit_event (actor_id, seq);

-- index audit_event_client_seq
CREATE INDEX audit_event_client_seq ON audit_event (client_id, seq);

-- index audit_event_target
CREATE INDEX audit_event_target ON audit_event (target);

-- index auth_challenge_expires
CREATE INDEX auth_challenge_expires ON auth_challenge (expires_at);

-- index backup_run_finished
CREATE INDEX backup_run_finished ON backup_run (finished_at);

-- index credential_person
CREATE INDEX credential_person ON credential (person_id);

-- index enrolment_person
CREATE INDEX enrolment_person ON enrolment (person_id);

-- index oidc_flow_expires
CREATE INDEX oidc_flow_expires ON oidc_flow (expires_at);

-- index person_firm
CREATE INDEX person_firm ON person (firm_id);

-- index person_identity_live
CREATE UNIQUE INDEX person_identity_live ON person_identity (issuer, subject) WHERE revoked_at IS NULL;

-- index person_identity_one
CREATE UNIQUE INDEX person_identity_one ON person_identity (person_id, issuer) WHERE revoked_at IS NULL;

-- index project_number
CREATE UNIQUE INDEX project_number ON project (number) WHERE number IS NOT NULL;

-- index recovery_attempt_failed
CREATE INDEX recovery_attempt_failed ON recovery_attempt (failed_at);

-- index session_person
CREATE INDEX session_person ON session (person_id);

-- index week_row_client_week
CREATE INDEX week_row_client_week ON week_row (client_id, week_start);

-- index week_submission_state_week
CREATE INDEX week_submission_state_week ON week_submission (state, week_start);

-- trigger audit_link
CREATE TRIGGER audit_link BEFORE INSERT ON audit_event
WHEN NEW.seq IS NOT (SELECT coalesce(max(seq), 0) + 1 FROM audit_event)
  OR NEW.prev_hash IS NOT coalesce(
    (SELECT hash FROM audit_event ORDER BY seq DESC LIMIT 1),
    '0000000000000000000000000000000000000000000000000000000000000000'
  )
BEGIN
  SELECT RAISE(ABORT, 'audit_link');
END;

-- trigger audit_no_delete
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_event
BEGIN
  SELECT RAISE(ABORT, 'audit_append_only');
END;

-- trigger audit_no_update
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_event
BEGIN
  SELECT RAISE(ABORT, 'audit_append_only');
END;

-- trigger entry_day_cap_insert
CREATE TRIGGER entry_day_cap_insert BEFORE INSERT ON entry
WHEN NEW.hundredths + (
  SELECT coalesce(sum(e.hundredths), 0)
  FROM entry e
  JOIN week_row r ON r.id = e.row_id
  JOIN week_row n ON n.id = NEW.row_id
  WHERE r.person_id = n.person_id AND r.week_start = n.week_start AND e.dow = NEW.dow
) > 2400
BEGIN
  SELECT RAISE(ABORT, 'day_cap');
END;

-- trigger entry_day_cap_update
CREATE TRIGGER entry_day_cap_update BEFORE UPDATE ON entry
WHEN NEW.hundredths + (
  SELECT coalesce(sum(e.hundredths), 0)
  FROM entry e
  JOIN week_row r ON r.id = e.row_id
  JOIN week_row n ON n.id = NEW.row_id
  WHERE r.person_id = n.person_id AND r.week_start = n.week_start AND e.dow = NEW.dow
    AND e.id IS NOT OLD.id
) > 2400
BEGIN
  SELECT RAISE(ABORT, 'day_cap');
END;
