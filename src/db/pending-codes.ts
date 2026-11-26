// The recovery codes a person has just made, held briefly so a reload still shows them.
// The row is bound to the creating session by a keyed hash and sealed (AES-GCM) under a key derived from that
// session's raw id, which the database never holds, so a read of the table shows no code. Expired rows are
// pruned on every write and read.
import { derivedKey, keyedHash } from '../auth/tokens';

const PUT = `INSERT INTO pending_codes (person_id, session_hash, codes, expires_at) VALUES (?1, ?2, ?3, ?4)
ON CONFLICT (person_id) DO UPDATE SET session_hash = excluded.session_hash, codes = excluded.codes,
  expires_at = excluded.expires_at`;

const toB64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const fromB64 = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function sealKey(secret: string, rawId: string): Promise<CryptoKey> {
  const raw = new Uint8Array(await derivedKey(secret, 'pending', rawId));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function seal(secret: string, rawId: string, codes: readonly string[]): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await sealKey(secret, rawId),
    new TextEncoder().encode(codes.join('\n')),
  );
  return `${toB64(iv)}.${toB64(new Uint8Array(body))}`;
}

async function unseal(secret: string, rawId: string, sealed: string): Promise<string[]> {
  const [iv = '', body = ''] = sealed.split('.');
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(iv) },
      await sealKey(secret, rawId),
      fromB64(body),
    );
    return new TextDecoder().decode(plain).split('\n');
  } catch {
    return [];
  }
}

/** Statements for one batch: drop every expired row of anyone, then store this person's sealed codes. */
export async function putPendingCodes(
  db: D1Database,
  secret: string,
  session: { readonly personId: string; readonly rawId: string },
  codes: readonly string[],
  now: number,
  lifeMs: number,
): Promise<D1PreparedStatement[]> {
  return [
    db.prepare('DELETE FROM pending_codes WHERE expires_at <= ?1').bind(now),
    db
      .prepare(PUT)
      .bind(
        session.personId,
        await keyedHash(secret, 'pending', session.rawId),
        await seal(secret, session.rawId, codes),
        now + lifeMs,
      ),
  ];
}

/** The unexpired codes this session made and has not acknowledged, or none; the caller's expired row is deleted. */
export async function pendingCodesOf(
  db: D1Database,
  secret: string,
  session: { readonly personId: string; readonly rawId: string },
  now: number,
): Promise<string[]> {
  await db
    .prepare('DELETE FROM pending_codes WHERE person_id = ?1 AND expires_at <= ?2')
    .bind(session.personId, now)
    .run();
  const row = await db
    .prepare('SELECT codes FROM pending_codes WHERE person_id = ?1 AND session_hash = ?2')
    .bind(session.personId, await keyedHash(secret, 'pending', session.rawId))
    .first<{ codes: string }>();
  return row ? await unseal(secret, session.rawId, row.codes) : [];
}

export async function clearPendingCodes(db: D1Database, personId: string): Promise<void> {
  await db.prepare('DELETE FROM pending_codes WHERE person_id = ?1').bind(personId).run();
}
