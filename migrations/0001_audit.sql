CREATE TABLE audit_event (
  seq INTEGER PRIMARY KEY CHECK (seq > 0),
  at INTEGER NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  client_id TEXT,
  target TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE
) STRICT;

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
