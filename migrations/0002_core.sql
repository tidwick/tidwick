CREATE TABLE client (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at INTEGER NOT NULL,
  archived_at INTEGER,
  erased_at INTEGER
) STRICT;

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

CREATE TABLE firm (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  client_id TEXT NOT NULL UNIQUE REFERENCES client (id)
) STRICT;

CREATE TABLE person (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firm (id),
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  external_code TEXT,
  created_at INTEGER NOT NULL,
  offboarded_at INTEGER
) STRICT;

CREATE INDEX person_firm ON person (firm_id);

CREATE TABLE person_role (
  person_id TEXT NOT NULL REFERENCES person (id),
  role TEXT NOT NULL CHECK (role IN ('accounting_admin', 'admin')),
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (person_id, role)
) STRICT;

CREATE TABLE task_code (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  archived_at INTEGER
) STRICT;

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

CREATE UNIQUE INDEX project_number ON project (number) WHERE number IS NOT NULL;

CREATE TABLE project_task (
  client_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  task_code_id TEXT NOT NULL REFERENCES task_code (id),
  archived_at INTEGER,
  PRIMARY KEY (client_id, project_id, task_code_id),
  FOREIGN KEY (client_id, project_id) REFERENCES project (client_id, id)
) STRICT;

CREATE TABLE assignment (
  client_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES person (id),
  assigned_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, person_id),
  FOREIGN KEY (client_id, project_id) REFERENCES project (client_id, id)
) STRICT;

CREATE INDEX assignment_person ON assignment (person_id);

CREATE TABLE import_batch (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES person (id),
  rows_read INTEGER NOT NULL CHECK (rows_read >= 0),
  entries_written INTEGER NOT NULL CHECK (entries_written >= 0),
  rejected_json TEXT NOT NULL CHECK (json_valid(rejected_json)),
  started_at INTEGER NOT NULL,
  finished_at INTEGER
) STRICT;

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

CREATE INDEX week_row_client_week ON week_row (client_id, week_start);

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

CREATE TABLE week_submission (
  person_id TEXT NOT NULL REFERENCES person (id),
  week_start TEXT NOT NULL CHECK (date(week_start) IS week_start AND strftime('%w', week_start) = '1'),
  state TEXT NOT NULL CHECK (state IN ('submitted', 'approved', 'returned')),
  submitted_at INTEGER NOT NULL,
  decided_by TEXT REFERENCES person (id),
  decided_at INTEGER,
  PRIMARY KEY (person_id, week_start)
) STRICT;

CREATE INDEX week_submission_state_week ON week_submission (state, week_start);

-- audit_event gains its references now that person and client exist: rebuild it, keeping every row.
CREATE TABLE audit_event_next (
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

INSERT INTO audit_event_next SELECT * FROM audit_event;

DROP TABLE audit_event;

ALTER TABLE audit_event_next RENAME TO audit_event;

CREATE INDEX audit_event_client_seq ON audit_event (client_id, seq);
CREATE INDEX audit_event_target ON audit_event (target);
CREATE INDEX audit_event_actor_seq ON audit_event (actor_id, seq);

CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_event
BEGIN
  SELECT RAISE(ABORT, 'audit_append_only');
END;

CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_event
BEGIN
  SELECT RAISE(ABORT, 'audit_append_only');
END;

CREATE TRIGGER audit_link BEFORE INSERT ON audit_event
WHEN NEW.seq IS NOT (SELECT coalesce(max(seq), 0) + 1 FROM audit_event)
  OR NEW.prev_hash IS NOT coalesce(
    (SELECT hash FROM audit_event ORDER BY seq DESC LIMIT 1),
    '0000000000000000000000000000000000000000000000000000000000000000'
  )
BEGIN
  SELECT RAISE(ABORT, 'audit_link');
END;
