// Sessions: an opaque 256-bit id in a __Host- cookie, stored only as its hash, 8 hours idle, 14 days absolute.
import { insertSession, liveSession, revokeSession, touchSession } from '../db/sessions';
import { keyedHash, randomToken } from './tokens';

export const SESSION_COOKIE = '__Host-tidwick-session';
export const IDLE_MS = 8 * 60 * 60 * 1000;
export const ABSOLUTE_MS = 14 * 24 * 60 * 60 * 1000;
/** A demo sign-in's whole life; its step-up stamp is set to the expiry, so it never meets a passkey prompt. */
export const DEMO_SESSION_MS = 2 * 60 * 60 * 1000;
/** `seen_at` is written at most this often, so a busy session costs one write a minute, not one per request. */
export const TOUCH_MS = 60 * 1000;

export interface Session {
  readonly rawId: string;
  readonly personId: string;
  readonly name: string;
  readonly mustEnrol: boolean;
  readonly stepUpAt: number;
}

/** The attributes every tidwick cookie carries; `__Host-` requires Secure, Path=/ and no Domain. */
export function hostCookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Path=/; Max-Age=${String(maxAgeSeconds)}; HttpOnly; Secure; SameSite=Strict`;
}

export function sessionCookie(rawId: string, lifeMs = ABSOLUTE_MS): string {
  return hostCookie(SESSION_COOKIE, rawId, lifeMs / 1000);
}

export function clearedSessionCookie(): string {
  return hostCookie(SESSION_COOKIE, '', 0);
}

/** The value of one cookie from a Cookie header, or null. */
export function cookieValue(header: string | null, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

/** A fresh session id and the insert for it, to ride the batch of the ceremony that earned it. */
export async function newSession(
  db: D1Database,
  secret: string,
  personId: string,
  now: number,
  mustEnrol = false,
  demo = false,
): Promise<{ rawId: string; statement: D1PreparedStatement }> {
  const rawId = randomToken();
  const idHash = await keyedHash(secret, 'session', rawId);
  const expiresAt = now + (demo ? DEMO_SESSION_MS : ABSOLUTE_MS);
  const row = { idHash, personId, expiresAt, mustEnrol, stepUpAt: demo ? expiresAt : now };
  return { rawId, statement: insertSession(db, row, now) };
}

/**
 * The live session behind a cookie value, or null when it is unknown, revoked, idle for 8 hours, past its
 * 14-day cap, or its person is offboarded. Refreshes `seen_at` at most once a minute.
 */
export async function readSession(
  db: D1Database,
  secret: string,
  rawId: string,
  now: number,
): Promise<Session | null> {
  const idHash = await keyedHash(secret, 'session', rawId);
  const row = await liveSession(db, idHash);
  if (!row || row.offboarded_at !== null) return null;
  if (now - row.seen_at >= IDLE_MS || now >= row.expires_at) return null;
  if (now - row.seen_at >= TOUCH_MS) await touchSession(db, idHash, now);
  return {
    rawId,
    personId: row.person_id,
    name: row.name,
    mustEnrol: row.must_enrol === 1,
    stepUpAt: row.step_up_at,
  };
}

/** Revokes the session behind a cookie value; an unknown or revoked one changes nothing. */
export async function endSession(
  db: D1Database,
  secret: string,
  rawId: string,
  now: number,
): Promise<void> {
  await revokeSession(db, await keyedHash(secret, 'session', rawId), now).run();
}
