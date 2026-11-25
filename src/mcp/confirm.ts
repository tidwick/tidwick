// The confirmation `submit_week` asks for: an HMAC over the person, the grant, the week and the week's fingerprint,
// good for ten minutes. It carries the fingerprint so the submit can check it inside its own statement.
import { keyedHash, sameText } from '../auth/tokens';
import type { Fingerprint } from '../db/submissions';

export const CONFIRM_MS = 10 * 60 * 1000;

async function mac(
  secret: string,
  who: { personId: string; grantId: string },
  weekStart: string,
  print: Fingerprint,
  expires: number,
): Promise<string> {
  const text = [who.personId, who.grantId, weekStart, print.n, print.total, print.latest, expires];
  return keyedHash(secret, 'agent_confirm', text.join('|'));
}

export async function mintConfirm(
  secret: string,
  who: { personId: string; grantId: string },
  weekStart: string,
  print: Fingerprint,
  now: number,
): Promise<string> {
  const expires = now + CONFIRM_MS;
  const tag = await mac(secret, who, weekStart, print, expires);
  return [expires, print.n, print.total, print.latest, tag].join('.');
}

/** The fingerprint a confirmation vouches for, or null when it is malformed, forged, for another week or person, or late. */
export async function openConfirm(
  secret: string,
  who: { personId: string; grantId: string },
  weekStart: string,
  confirm: string,
  now: number,
): Promise<Fingerprint | null> {
  const [expires, n, total, latest, tag, ...rest] = confirm.split('.');
  const numbers = [expires, n, total, latest].map((part) => Number(part ?? ''));
  if (rest.length > 0 || tag === undefined || !numbers.every(Number.isSafeInteger)) return null;
  const [at = 0, count = 0, sum = 0, newest = 0] = numbers;
  if (at <= now) return null;
  const print = { n: count, total: sum, latest: newest };
  return sameText(tag, await mac(secret, who, weekStart, print, at)) ? print : null;
}
