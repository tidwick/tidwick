// A wrapped data key for every seeded client, under the KEK the seed is loaded with, so a note can be saved on any
// of them. The data key is derived from the KEK and the client, so a second `just seed` against the same database
// adds weeks sealed under the keys the first one stored.
import { sealNote, wrapClientKey } from '../../src/lib/note-crypto.ts';
import { SEED_CLIENT_IDS } from './build.ts';

type Bytes = Uint8Array<ArrayBuffer>;

const KEY_VERSION = 1;

export const hex = (bytes: Uint8Array): string => `X'${Buffer.from(bytes).toString('hex')}'`;

async function dataKeyOf(kek: string, clientId: string): Promise<Bytes> {
  const text = new TextEncoder().encode(`tidwick/seed-key|${kek}|${clientId}`);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', text));
}

/** One `client_key` insert per seeded client, or per client in `clientIds`. */
export async function seedKeyStatements(
  kek: string,
  clientIds: readonly string[] = SEED_CLIENT_IDS,
): Promise<string[]> {
  return Promise.all(
    clientIds.map(async (clientId) => {
      const key = await wrapClientKey(kek, clientId, KEY_VERSION, await dataKeyOf(kek, clientId));
      return `INSERT OR IGNORE INTO client_key (client_id, version, wrapped, iv, kek_id, created_at) VALUES ('${clientId}', ${String(KEY_VERSION)}, ${hex(key.wrapped)}, ${hex(key.iv)}, '${key.kekId}', 1);`;
    }),
  );
}

/** A note sealed for an entry under the client's seed key, as the `note_ct`, `note_iv` and `key_version` values. */
export async function sealedSeedNote(
  kek: string,
  clientId: string,
  entryId: string,
  text: string,
): Promise<string> {
  const note = await sealNote(await dataKeyOf(kek, clientId), clientId, entryId, text);
  return `${hex(note.ct)}, ${hex(note.iv)}, ${String(KEY_VERSION)}`;
}
