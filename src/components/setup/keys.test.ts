import { Decrypter, Encrypter } from 'age-encryption';
import { describe, expect, it } from 'vitest';
import { isAgeRecipient, isNoteKek, isSessionSecret } from '../../lib/secrets';
import { ageKey, noteKek, sessionSecret } from './keys';

describe('the setup page keys', () => {
  it('makes a SESSION_SECRET (base64url, no padding) and a NOTE_KEK the env accepts, fresh each call', () => {
    const a = sessionSecret();
    expect(isSessionSecret(a)).toBe(true);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sessionSecret()).not.toBe(a);
    const k = noteKek();
    expect(isNoteKek(k)).toBe(true);
    expect(noteKek()).not.toBe(k);
  });

  it('makes an identity file restore.ts can read and a recipient the env accepts', async () => {
    const { recipient, file } = await ageKey();
    expect(isAgeRecipient(recipient)).toBe(true);
    const line = file.split('\n').find((l) => l.startsWith('AGE-SECRET-KEY-'));
    expect(line).toBeDefined();
    const encrypter = new Encrypter();
    encrypter.addRecipient(recipient);
    const sealed = await encrypter.encrypt('hello');
    const decrypter = new Decrypter();
    decrypter.addIdentity(line as string);
    expect(await decrypter.decrypt(sealed, 'text')).toBe('hello');
    expect(file).toContain(`# public key: ${recipient}`);
  });
});
