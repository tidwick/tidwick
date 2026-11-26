// Agent grants and their tokens: the SQL behind /mcp. A token is looked up only by the hash of its kind, so a
// refresh token or a session id presented as an access token finds nothing.

export type AgentTokenKind = 'code' | 'access' | 'refresh';

export interface GrantRow {
  id: string;
  person_id: string;
  client_id: string;
  client_name: string;
  scopes: string;
}

const INSERT_GRANT = `INSERT INTO agent_grant (id, person_id, client_id, client_name, redirect_uri, scopes, created_at, expires_at)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
WHERE ?9 IS NULL OR (SELECT count(*) FROM agent_grant WHERE person_id = ?2 AND revoked_at IS NULL
  AND (expires_at IS NULL OR expires_at > ?7)) < ?9`;

const INSERT_TOKEN =
  'INSERT INTO agent_token (hash, grant_id, kind, expires_at, challenge) VALUES (?1, ?2, ?3, ?4, ?5)';

const BY_ACCESS = `SELECT g.id, g.person_id, g.client_id, g.client_name, g.scopes
FROM agent_token t JOIN agent_grant g ON g.id = t.grant_id
WHERE t.hash = ?1 AND t.kind = 'access' AND t.expires_at > ?2 AND g.revoked_at IS NULL
AND (g.expires_at IS NULL OR g.expires_at > ?2)`;

const TOUCH = `UPDATE agent_grant SET last_used_at = ?2
WHERE id = ?1 AND (last_used_at IS NULL OR last_used_at <= ?2 - ?3)`;

const LIVE_OF =
  'SELECT id FROM agent_grant WHERE person_id = ?1 AND revoked_at IS NULL ORDER BY id';

const LISTED = `SELECT id, client_id, client_name, scopes, created_at, expires_at, last_used_at FROM agent_grant
WHERE person_id = ?1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?2) ORDER BY created_at DESC, id`;

const REVOKE_ONE =
  'UPDATE agent_grant SET revoked_at = ?3 WHERE id = ?1 AND person_id = ?2 AND revoked_at IS NULL';

const REVOKE_OF =
  'UPDATE agent_grant SET revoked_at = ?2 WHERE person_id = ?1 AND revoked_at IS NULL';

/** `last_used_at` is written at most this often, so a busy agent costs one write an hour. */
export const TOUCH_GRANT_MS = 60 * 60 * 1000;

export interface NewGrant {
  id: string;
  personId: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  scopes: readonly string[];
  /** When a personal token stops working; null for a grant that lives by its refresh tokens. */
  expiresAt?: number | null;
  /** The most live grants the person may hold; the insert changes nothing when they hold that many. */
  cap?: number;
}

export interface ListedGrant {
  id: string;
  client_id: string;
  client_name: string;
  scopes: string;
  created_at: number;
  expires_at: number | null;
  last_used_at: number | null;
}

export function insertGrant(db: D1Database, grant: NewGrant, now: number): D1PreparedStatement {
  return db
    .prepare(INSERT_GRANT)
    .bind(
      grant.id,
      grant.personId,
      grant.clientId,
      grant.clientName,
      grant.redirectUri,
      JSON.stringify(grant.scopes),
      now,
      grant.expiresAt ?? null,
      grant.cap ?? null,
    );
}

export function insertToken(
  db: D1Database,
  token: {
    hash: string;
    grantId: string;
    kind: AgentTokenKind;
    expiresAt: number;
    /** The PKCE S256 challenge a code was issued under. */
    challenge?: string;
  },
): D1PreparedStatement {
  return db
    .prepare(INSERT_TOKEN)
    .bind(token.hash, token.grantId, token.kind, token.expiresAt, token.challenge ?? null);
}

/** The live grant behind an access-token hash that has not expired, or null. */
export async function grantByAccessHash(
  db: D1Database,
  hash: string,
  now: number,
): Promise<GrantRow | null> {
  return db.prepare(BY_ACCESS).bind(hash, now).first<GrantRow>();
}

export async function touchGrant(db: D1Database, grantId: string, now: number): Promise<void> {
  await db.prepare(TOUCH).bind(grantId, now, TOUCH_GRANT_MS).run();
}

/** The ids of a person's unrevoked grants. */
export async function liveGrantIdsOf(db: D1Database, personId: string): Promise<string[]> {
  const found = await db.prepare(LIVE_OF).bind(personId).all<{ id: string }>();
  return found.results.map((row) => row.id);
}

/** Revokes every unrevoked grant of a person; the tokens die with them, since a lookup joins the grant. */
export function revokeGrantsOf(db: D1Database, personId: string, now: number): D1PreparedStatement {
  return db.prepare(REVOKE_OF).bind(personId, now);
}

/** A person's grants that still work (not revoked, not past their end), newest first. */
export async function listedGrantsOf(
  db: D1Database,
  personId: string,
  now: number,
): Promise<ListedGrant[]> {
  return (await db.prepare(LISTED).bind(personId, now).all<ListedGrant>()).results;
}

/** Revokes one grant of the person; it changes nothing for another person's id or an unknown one. */
export function revokeGrant(
  db: D1Database,
  personId: string,
  grantId: string,
  now: number,
): D1PreparedStatement {
  return db.prepare(REVOKE_ONE).bind(grantId, personId, now);
}
