// Recovery codes: ten per person, 16 Crockford base32 characters (80 bits), stored as hashes; the plain batch is also held in pending_codes for `PENDING_CODES_MINUTES`.
import { auditedBatch, retryOnce } from '../db/audit';
import { closeCodesOf, insertCodes, unusedCodeCount } from '../db/recovery-codes';
import { putPendingCodes } from '../db/pending-codes';
import type { Scope } from '../db/scope';
import { DEFAULT_POLICY } from '../lib/policy';
import { keyedHash } from './tokens';

/** Fixed: ten codes a person, so the count is never a guessing aid or a burden to store. */
export const CODES_PER_PERSON = 10;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE = /^[0-9A-HJKMNP-TV-Z]{16}$/;

/** 80 random bits as 16 Crockford base32 characters, grouped in fours for reading aloud. */
export function newRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(value >> bits) & 31] ?? '';
    }
  }
  return out.match(/.{4}/g)?.join('-') ?? out;
}

/** Folds what a person types into the stored form: case, spaces and dashes ignored, O as 0, I and L as 1. */
export function normalizeCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return CODE.test(code) ? code : null;
}

export async function codeHash(secret: string, normalized: string): Promise<string> {
  return keyedHash(secret, 'recovery', normalized);
}

/** Ten fresh codes and their hashes, to be inserted after the person's unused codes are retired. */
export async function freshCodes(secret: string): Promise<{ codes: string[]; hashes: string[] }> {
  const codes = Array.from({ length: CODES_PER_PERSON }, newRecoveryCode);
  const hashes = await Promise.all(codes.map((c) => codeHash(secret, normalizeCode(c) ?? '')));
  return { codes, hashes };
}

/**
 * Replaces a person's codes in one audited batch: unused ones are retired, ten new ones are stored as hashes,
 * and the plain codes are returned once for the person to keep.
 */
export async function regenerateCodes(
  scope: Scope,
  db: D1Database,
  secret: string,
  personId: string,
  now: number,
  sessionId: string,
  lifeMs = DEFAULT_POLICY.pendingCodesMs,
): Promise<string[]> {
  const { codes, hashes } = await freshCodes(secret);
  const owner = await keyedHash(secret, 'pending', sessionId);
  await retryOnce(async () => {
    const unused = await unusedCodeCount(db, personId);
    const batch = await auditedBatch(scope, db);
    const event = {
      at: now,
      action: 'auth.regenerateCodes' as const,
      clientId: null,
      target: `person:${personId}`,
    };
    await batch.record(
      closeCodesOf(db, personId, now),
      { ...event, before: { unused }, after: { unused: CODES_PER_PERSON } },
      unused,
    );
    for (const insert of insertCodes(db, personId, hashes, now)) batch.also(insert);
    for (const put of putPendingCodes(db, personId, owner, codes, now, lifeMs)) batch.also(put);
    await batch.run();
  });
  return codes;
}
