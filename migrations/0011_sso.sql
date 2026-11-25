-- Single sign-on by OpenID Connect: a person's identity at an identity provider, and the one-time record of a
-- sign-in under way. An identity is keyed on its issuer and subject, never on an email, and is revoked, never
-- deleted. A flow is stored only as the HMAC of its id under SESSION_SECRET (hash kind `sso_flow`, src/auth/tokens.ts),
-- holds the PKCE verifier and nonce for ten minutes, and is used once.
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

CREATE UNIQUE INDEX person_identity_live ON person_identity (issuer, subject) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX person_identity_one ON person_identity (person_id, issuer) WHERE revoked_at IS NULL;

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

CREATE INDEX oidc_flow_expires ON oidc_flow (expires_at);
