import { describe, expect, it } from 'vitest';
import { kekFor, kekId, newClientKey, openNote, sealNote, unwrapClientKey } from './note-crypto';

const kek = (fill: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));

describe('client data keys', () => {
  it('a wrapped key unwraps to 32 bytes under the same KEK, client and version', async () => {
    const key = await newClientKey(kek(1), 'client-a', 1);
    expect(key.iv).toHaveLength(12);
    expect(key.kekId).toBe(await kekId(kek(1)));
    expect(await unwrapClientKey(kek(1), 'client-a', 1, key)).toHaveLength(32);
  });

  it('SEC-18 a wrapped key is refused under another KEK, client or version', async () => {
    const key = await newClientKey(kek(1), 'client-a', 1);
    await expect(unwrapClientKey(kek(2), 'client-a', 1, key)).rejects.toThrow();
    await expect(unwrapClientKey(kek(1), 'client-b', 1, key)).rejects.toThrow();
    await expect(unwrapClientKey(kek(1), 'client-a', 2, key)).rejects.toThrow();
  });

  it('a key row names its KEK: the current one, else the previous one, and never a third', async () => {
    const keks = { current: kek(1), previous: kek(2) };
    expect(await kekFor(keks, await kekId(kek(1)))).toBe(kek(1));
    expect(await kekFor(keks, await kekId(kek(2)))).toBe(kek(2));
    expect(await kekFor(keks, await kekId(kek(3)))).toBeNull();
    expect(await kekFor({ current: kek(1), previous: null }, await kekId(kek(2)))).toBeNull();
  });

  it('two keys for the same client differ, and the KEK id names the KEK', async () => {
    const a = await newClientKey(kek(1), 'client-a', 1);
    const b = await newClientKey(kek(1), 'client-a', 1);
    expect(a.wrapped).not.toEqual(b.wrapped);
    expect(await kekId(kek(1))).not.toBe(await kekId(kek(2)));
  });
});

describe('notes', () => {
  const dataKey = () => new Uint8Array(32).fill(7);

  it('SEC-18 a note opens to the text it was sealed from, and the ciphertext is not the text', async () => {
    const sealed = await sealNote(
      dataKey(),
      'client-a',
      'entry-1',
      'site visit, <b>second</b> floor',
    );
    expect(sealed.iv).toHaveLength(12);
    expect(new TextDecoder().decode(sealed.ct)).not.toContain('site visit');
    expect(await openNote(dataKey(), 'client-a', 'entry-1', sealed)).toBe(
      'site visit, <b>second</b> floor',
    );
  });

  it('SEC-18 ciphertext copied to another client or entry, or opened under another key, fails to decrypt', async () => {
    const sealed = await sealNote(dataKey(), 'client-a', 'entry-1', 'private');
    await expect(openNote(dataKey(), 'client-b', 'entry-1', sealed)).rejects.toThrow();
    await expect(openNote(dataKey(), 'client-a', 'entry-2', sealed)).rejects.toThrow();
    await expect(
      openNote(new Uint8Array(32).fill(8), 'client-a', 'entry-1', sealed),
    ).rejects.toThrow();
  });

  it('the same text sealed twice differs, so equal notes are not visible as equal', async () => {
    const a = await sealNote(dataKey(), 'client-a', 'entry-1', 'same');
    const b = await sealNote(dataKey(), 'client-a', 'entry-1', 'same');
    expect(a.ct).not.toEqual(b.ct);
    expect(a.iv).not.toEqual(b.iv);
  });
});
