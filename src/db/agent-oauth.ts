// The OAuth side of agent grants: spending a code or a refresh token, activating a grant, and cutting one. A token
// is spent by one UPDATE that matches only an unspent, unexpired row, so two requests with the same token cannot both
// win; a token seen again after it was spent is the signal that a copy leaked.
import type { AgentTokenKind } from './agent-grants';

export interface OauthGrant {
  id: string;
  person_id: string;
  client_id: string;
  client_name: string;
  redirect_uri: string;
  scopes: string;
  created_at: number;
}

const SPEND = `UPDATE agent_token SET used_at = ?3
WHERE hash = ?1 AND kind = ?2 AND used_at IS NULL AND expires_at > ?3
RETURNING grant_id, challenge`;

const WAS_SPENT =
  'SELECT grant_id FROM agent_token WHERE hash = ?1 AND kind = ?2 AND used_at IS NOT NULL';

const LIVE_GRANT = `SELECT id, person_id, client_id, client_name, redirect_uri, scopes, created_at FROM agent_grant
WHERE id = ?1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?2)`;

const ACTIVATE =
  'UPDATE agent_grant SET expires_at = created_at + ?2 WHERE id = ?1 AND revoked_at IS NULL';

const PRUNE = 'DELETE FROM agent_token WHERE grant_id = ?1 AND expires_at < ?2';

const REVOKE_BY_ID = 'UPDATE agent_grant SET revoked_at = ?2 WHERE id = ?1 AND revoked_at IS NULL';

const REVOKE_CLIENT =
  'UPDATE agent_grant SET revoked_at = ?3 WHERE person_id = ?1 AND client_id = ?2 AND revoked_at IS NULL';

/** Spends a code or refresh token; null when it is unknown, expired or already spent. */
export async function spendToken(
  db: D1Database,
  hash: string,
  kind: Extract<AgentTokenKind, 'code' | 'refresh'>,
  now: number,
): Promise<{ grant_id: string; challenge: string | null } | null> {
  return db
    .prepare(SPEND)
    .bind(hash, kind, now)
    .first<{ grant_id: string; challenge: string | null }>();
}

/** The grant a token of this kind was spent for, when the token has been spent before: its second use. */
export async function spentFor(
  db: D1Database,
  hash: string,
  kind: Extract<AgentTokenKind, 'code' | 'refresh'>,
): Promise<string | null> {
  return (
    (await db.prepare(WAS_SPENT).bind(hash, kind).first<{ grant_id: string }>())?.grant_id ?? null
  );
}

/** The grant when it is neither revoked nor past its end, else null. */
export async function liveGrant(
  db: D1Database,
  id: string,
  now: number,
): Promise<OauthGrant | null> {
  return db.prepare(LIVE_GRANT).bind(id, now).first<OauthGrant>();
}

/** Gives a grant its absolute end, `lifeMs` after it was made; a grant waiting for its code ends 60 seconds in. */
export function activateGrant(db: D1Database, id: string, lifeMs: number): D1PreparedStatement {
  return db.prepare(ACTIVATE).bind(id, lifeMs);
}

/** Drops the grant's tokens that have ended, so a long-lived grant does not collect a row per refresh. */
export function pruneTokens(db: D1Database, grantId: string, now: number): D1PreparedStatement {
  return db.prepare(PRUNE).bind(grantId, now);
}

export function revokeGrantById(db: D1Database, id: string, now: number): D1PreparedStatement {
  return db.prepare(REVOKE_BY_ID).bind(id, now);
}

/** Revokes a person's live grants of one client, so approving again replaces the earlier grant. */
export function revokeClientGrants(
  db: D1Database,
  personId: string,
  clientId: string,
  now: number,
): D1PreparedStatement {
  return db.prepare(REVOKE_CLIENT).bind(personId, clientId, now);
}
