// Stored credentials as SimpleWebAuthn sees them, and the user handle a person's passkeys carry.
import { blobBytes, type CredentialRow } from '../db/credentials';
import type { WebAuthnCredential } from './webauthn';

const TRANSPORTS = new Set<string>([
  'ble',
  'cable',
  'hybrid',
  'internal',
  'nfc',
  'smart-card',
  'usb',
]);

function transportsOf(json: string): string[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((t): t is string => typeof t === 'string' && TRANSPORTS.has(t));
}

export function storedCredential(row: CredentialRow): WebAuthnCredential {
  const transports = transportsOf(row.transports);
  return {
    id: row.id,
    publicKey: blobBytes(row.public_key),
    counter: row.counter,
    ...(transports.length > 0 ? { transports } : {}),
  };
}

/** The opaque user handle: the person's UUID as bytes, never their email. */
export function userHandle(personId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(personId);
}
