// Agent access tokens: opaque 256-bit bearers stored as `keyedHash` of their own kind, so a refresh token, a code or a
// session id never authenticates as an access token. The `/mcp` route is the only reader of a bearer.
import { grantByAccessHash, insertToken, type GrantRow } from '../db/agent-grants';
import { keyedHash, randomToken } from './tokens';

/** An access token lives an hour; hosted clients refresh a few minutes before it ends. */
export const ACCESS_MS = 60 * 60 * 1000;

// A token is 32 random bytes as base64url, 43 characters; anything else is refused before any database read.
const BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/;

/** The token in an `Authorization` header, or null when it is absent or not shaped like one of ours. */
export function bearerOf(header: string | null): string | null {
  return header === null ? null : (BEARER.exec(header)?.[1] ?? null);
}

/** A new access token for a grant: the raw value to hand over once, and the insert that stores its hash. */
export async function newAccessToken(
  db: D1Database,
  secret: string,
  grantId: string,
  now: number,
): Promise<{ token: string; statement: D1PreparedStatement }> {
  const token = randomToken();
  const hash = await keyedHash(secret, 'agent_access', token);
  return {
    token,
    statement: insertToken(db, { hash, grantId, kind: 'access', expiresAt: now + ACCESS_MS }),
  };
}

/** The live grant an access token belongs to, or null when it is unknown, expired, of another kind or revoked. */
export async function verifyAccess(
  db: D1Database,
  secret: string,
  token: string,
  now: number,
): Promise<GrantRow | null> {
  return grantByAccessHash(db, await keyedHash(secret, 'agent_access', token), now);
}
