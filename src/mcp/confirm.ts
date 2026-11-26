// The confirmation `submit_week` asks for: an HMAC over the person, the grant, the week and the week's fingerprint
// text (src/lib/fingerprint.ts), good for ten minutes. It carries the fingerprint so the submit can pass it on as
// `unchanged`, and the statement that submits checks it inside itself.
import { keyedHash, sameText } from '../auth/tokens';
import { fingerprintText, parseFingerprint, type Fingerprint } from '../lib/fingerprint';

/** Fixed (security floor): how long an agent's confirmation of a changed week stays valid; it names the exact change, so it is kept short. */
export const CONFIRM_MS = 10 * 60 * 1000;

interface Holder {
  personId: string;
  grantId: string;
}

const mac = (secret: string, who: Holder, weekStart: string, print: string, expires: number) =>
  keyedHash(
    secret,
    'agent_confirm',
    [who.personId, who.grantId, weekStart, print, expires].join('|'),
  );

export async function mintConfirm(
  secret: string,
  who: Holder,
  weekStart: string,
  print: Fingerprint,
  now: number,
): Promise<string> {
  const expires = now + CONFIRM_MS;
  const text = fingerprintText(print);
  return [expires, text, await mac(secret, who, weekStart, text, expires)].join('~');
}

/** The fingerprint a confirmation vouches for, or null when it is malformed, forged, for another week or person, or late. */
export async function openConfirm(
  secret: string,
  who: Holder,
  weekStart: string,
  confirm: string,
  now: number,
): Promise<Fingerprint | null> {
  const [expiresText, text, tag, ...rest] = confirm.split('~');
  const expires = Number(expiresText ?? '');
  const print = parseFingerprint(text ?? '');
  if (rest.length > 0 || tag === undefined || print === null || !Number.isSafeInteger(expires))
    return null;
  if (expires <= now) return null;
  return sameText(tag, await mac(secret, who, weekStart, text ?? '', expires)) ? print : null;
}
