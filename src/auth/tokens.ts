// Random secrets, their keyed hashes, and the CSRF token derived from a session id. No imports, so the
// e2e fixture script can hash an enrolment token exactly as the Worker does.

const encoder = new TextEncoder();

/** What a hashed value is, mixed into the HMAC so a hash of one kind never matches another. */
export type HashKind =
  | 'enrol'
  | 'session'
  | 'challenge'
  | 'recovery'
  | 'email'
  | 'ip'
  | 'agent_code'
  | 'agent_access'
  | 'agent_refresh'
  | 'agent_confirm';

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 256 random bits as base64url: enrolment tokens, session ids and challenge ids. */
export function randomToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

/** The stored form of a token, code, id or email: hex HMAC-SHA256 of `<kind>|<value>` under SESSION_SECRET. */
export async function keyedHash(secret: string, kind: HashKind, value: string): Promise<string> {
  const mac = await hmac(secret, `${kind}|${value}`);
  return Array.from(mac, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The synchronizer token for a session: base64url HMAC of `csrf|<raw session id>`, derived, never stored. */
export async function csrfToken(secret: string, rawSessionId: string): Promise<string> {
  return toBase64Url(await hmac(secret, `csrf|${rawSessionId}`));
}

/** Compares two strings in time that depends only on their lengths. */
export function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
