// Per-client data keys, wrapped under NOTE_KEK and bound to their client and version (DESIGN: Notes). Only
// this module sees a key; an unwrapped key lives for one request.

const encoder = new TextEncoder();
const IV_BYTES = 12;

type Bytes = Uint8Array<ArrayBuffer>;

export interface WrappedKey {
  wrapped: Bytes;
  iv: Bytes;
  kekId: string;
}

function fromBase64(value: string): Bytes {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function kekKey(kek: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromBase64(kek), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function aad(clientId: string, version: number): Bytes {
  return encoder.encode(`tidwick/client-key/v1|${clientId}|${String(version)}`);
}

/** A short digest naming which KEK wrapped a key, so rotation can find the keys still on the old one. */
export async function kekId(kek: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', fromBase64(kek)));
  return Array.from(digest.slice(0, 4), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The KEK that wraps new keys, and while a rotation is under way the one it retires (DESIGN: Notes). */
export interface NoteKeks {
  current: string;
  previous: string | null;
}

/** Which KEK wrapped a key whose row names `id`: the current one, else the previous one, else neither (null). */
export async function kekFor(keks: NoteKeks, id: string): Promise<string | null> {
  if ((await kekId(keks.current)) === id) return keks.current;
  if (keks.previous !== null && (await kekId(keks.previous)) === id) return keks.previous;
  return null;
}

/** A 256-bit data key wrapped under the KEK for a client and version; the only place a key is wrapped. */
export async function wrapClientKey(
  kek: string,
  clientId: string,
  version: number,
  dataKey: Bytes,
): Promise<WrappedKey> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(clientId, version) },
    await kekKey(kek),
    dataKey,
  );
  return { wrapped: new Uint8Array(sealed), iv, kekId: await kekId(kek) };
}

/** A new random 256-bit data key for a client, returned only in wrapped form. */
export function newClientKey(kek: string, clientId: string, version: number): Promise<WrappedKey> {
  return wrapClientKey(kek, clientId, version, crypto.getRandomValues(new Uint8Array(32)));
}

/** The data key behind a wrapped one; throws when the KEK, client or version is not the one it was wrapped for. */
export async function unwrapClientKey(
  kek: string,
  clientId: string,
  version: number,
  key: Pick<WrappedKey, 'wrapped' | 'iv'>,
): Promise<Bytes> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: key.iv, additionalData: aad(clientId, version) },
    await kekKey(kek),
    key.wrapped,
  );
  return new Uint8Array(plain);
}

export interface SealedNote {
  ct: Bytes;
  iv: Bytes;
}

const noteAad = (clientId: string, entryId: string): Bytes =>
  encoder.encode(`tidwick/note/v1|${clientId}|${entryId}`);

const dataKeyOf = (dataKey: Bytes): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', dataKey, 'AES-GCM', false, ['encrypt', 'decrypt']);

/** A note's text under a client's data key, bound to that client and entry; a fresh random iv every time. */
export async function sealNote(
  dataKey: Bytes,
  clientId: string,
  entryId: string,
  text: string,
): Promise<SealedNote> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: noteAad(clientId, entryId) },
    await dataKeyOf(dataKey),
    encoder.encode(text),
  );
  return { ct: new Uint8Array(sealed), iv };
}

/** A note's text; throws when the key, client or entry is not the one it was sealed for. */
export async function openNote(
  dataKey: Bytes,
  clientId: string,
  entryId: string,
  note: SealedNote,
): Promise<string> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: note.iv, additionalData: noteAad(clientId, entryId) },
    await dataKeyOf(dataKey),
    note.ct,
  );
  return new TextDecoder().decode(plain);
}
