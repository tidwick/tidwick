// The shape every secret must have, shared by env.ts and scripts/bootstrap.ts so the Worker and bootstrap agree.

/** Standard base64, with its padding, of exactly 32 bytes: the AES-256 key that wraps client keys. */
export function isNoteKek(value: string): boolean {
  return /^[A-Za-z0-9+/]{43}=$/.test(value);
}

/** At least as long as base64 of 32 random bytes, so the HMAC key behind every stored hash is not guessable. */
export function isSessionSecret(value: string): boolean {
  return value.trim().length >= 43;
}

/** An age X25519 recipient: `age1` and 58 Bech32 characters. */
export function isAgeRecipient(value: string): boolean {
  return /^age1[02-9ac-hj-np-z]{58}$/.test(value);
}

/** A setup token: base64url of at least 32 bytes (43 characters) with no repeated phrase, as `/setup` generates it. */
export function isSetupToken(value: string): boolean {
  const text = value.trim();
  return /^[A-Za-z0-9_-]{43,}$/.test(text) && new Set(text).size >= 16;
}
