-- Nothing writes client erasure, a destroyed key, the 'link' flow purpose or a rate window, so they go. Rebuilt tables
-- go through a keep table, as in 0002, so the rows that hold foreign keys into them survive.
ALTER TABLE client DROP COLUMN erased_at;

PRAGMA defer_foreign_keys = on;
CREATE TABLE client_key_keep AS
  SELECT client_id, version, wrapped, iv, kek_id, created_at FROM client_key;
DROP TABLE client_key;
CREATE TABLE client_key (
  client_id TEXT NOT NULL REFERENCES client (id),
  version INTEGER NOT NULL CHECK (version > 0),
  wrapped BLOB NOT NULL,
  iv BLOB NOT NULL,
  kek_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (client_id, version)
) STRICT;
INSERT INTO client_key (client_id, version, wrapped, iv, kek_id, created_at)
  SELECT client_id, version, wrapped, iv, kek_id, created_at FROM client_key_keep;
DROP TABLE client_key_keep;

CREATE TABLE oidc_flow_keep AS SELECT * FROM oidc_flow WHERE purpose <> 'link';
DROP TABLE oidc_flow;
CREATE TABLE oidc_flow (
  id_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('login', 'enrol', 'step_up')),
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
INSERT INTO oidc_flow SELECT * FROM oidc_flow_keep;
DROP TABLE oidc_flow_keep;
CREATE INDEX oidc_flow_expires ON oidc_flow (expires_at);
