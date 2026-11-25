// The three values the setup page makes in the browser: nothing here is sent anywhere, and the page has no form.
// The shapes are the ones `src/lib/secrets.ts` accepts.
import { generateX25519Identity, identityToRecipient } from 'age-encryption';

const random = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32));
const base64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

/** 32 random bytes, base64url without padding. */
export const sessionSecret = (): string =>
  base64(random()).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

/** 32 random bytes, standard base64. */
export const noteKek = (): string => base64(random());

/** A new age identity: the public recipient, and a file laid out as `age-keygen` writes it, which restore reads. */
export async function ageKey(): Promise<{ recipient: string; file: string }> {
  const identity = await generateX25519Identity();
  const recipient = await identityToRecipient(identity);
  const file = `# created: ${new Date().toISOString()}\n# public key: ${recipient}\n${identity}\n`;
  return { recipient, file };
}
