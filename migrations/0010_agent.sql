-- Agent access: a person's grant to an MCP client, and the opaque tokens it holds. A token is stored only as an
-- HMAC under SESSION_SECRET, with its own hash kind (src/auth/tokens.ts), so a hash of one kind never matches another.
-- A grant is revoked, never deleted: the row says which client held access and until when.
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

CREATE INDEX agent_grant_person ON agent_grant (person_id);

CREATE TABLE agent_token (
  hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES agent_grant (id),
  kind TEXT NOT NULL CHECK (kind IN ('code', 'access', 'refresh')),
  expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX agent_token_grant ON agent_token (grant_id);
