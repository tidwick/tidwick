// Ceremony challenges: the id rides a 5-minute __Host- SameSite=Strict cookie, the row is consumed once.
import { consumeChallenge, insertChallenge, type ChallengePurpose } from '../db/challenges';
import type { AuthEnv } from '../lib/env';
import { hostCookie } from './session';
import { keyedHash, randomToken } from './tokens';

export const CHALLENGE_COOKIE = '__Host-tidwick-challenge';
export const CHALLENGE_MS = 5 * 60 * 1000;

export function challengeCookie(rawId: string): string {
  return hostCookie(CHALLENGE_COOKIE, rawId, CHALLENGE_MS / 1000);
}

export function clearedChallengeCookie(): string {
  return hostCookie(CHALLENGE_COOKIE, '', 0);
}

/** Stores a challenge for one purpose, and the person it is for when known; returns the raw id for the cookie. */
export async function storeChallenge(
  deps: AuthEnv,
  purpose: ChallengePurpose,
  personId: string | null,
  challenge: string,
  now: number,
): Promise<string> {
  const rawId = randomToken();
  const idHash = await keyedHash(deps.secret, 'challenge', rawId);
  await insertChallenge(
    deps.db,
    { idHash, purpose, personId, challenge, expiresAt: now + CHALLENGE_MS },
    now,
  );
  return rawId;
}

/** Consumes the challenge behind a cookie value once; a second call, a stale one or another purpose gets null. */
export async function takeChallenge(
  deps: AuthEnv,
  rawId: string | null,
  purpose: ChallengePurpose,
  now: number,
): Promise<{ challenge: string; personId: string | null } | null> {
  if (rawId === null) return null;
  const row = await consumeChallenge(
    deps.db,
    await keyedHash(deps.secret, 'challenge', rawId),
    purpose,
    now,
  );
  return row && { challenge: row.challenge, personId: row.person_id };
}
