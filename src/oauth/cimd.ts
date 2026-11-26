// A client is named by the https address of its own metadata document (a client ID metadata document). The server
// fetches it, so the fetch is narrow: https on port 443, no redirect followed, a body of at most 5 KB, 5 seconds, no
// IP-literal host and never this server's own host. The 5 KB and 5 second limits are this project's own choice.
// Only local development and the browser tests, where ORIGIN is itself http on a loopback host, fetch a loopback
// http document. The `global_fetch_strictly_public` compatibility flag (wrangler.jsonc) makes the runtime refuse a
// public name that resolves to a private address, which this file cannot see.
import { OauthError } from './error';
import { parseRedirect } from './redirect';

/** Fixed (security floor): a client's metadata document is fetched from a stranger's URL, so its size and wait are held small whatever the deploy. */
export const MAX_DOCUMENT_BYTES = 5 * 1024;
export const FETCH_TIMEOUT_MS = 5000;
/** Fixed: a bound on one untrusted document's list, not a policy. */
const MAX_REDIRECTS_LISTED = 10;
const NAME_MAX = 100;
const IPV4 = /^\d+\.\d+\.\d+\.\d+$/;

export interface Client {
  id: string;
  name: string;
  redirectUris: readonly string[];
}

const refuse = (message: string): never => {
  throw new OauthError('invalid_client', message);
};

/** The document's address when it may be fetched, else a refusal naming why. */
export function documentUrl(clientId: string, origin: string): URL {
  if (!URL.canParse(clientId)) return refuse('The client_id is not a web address.');
  const url = new URL(clientId);
  const here = new URL(origin);
  const local =
    here.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(here.hostname);
  if (
    local &&
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    return url;
  if (url.protocol !== 'https:' || url.port !== '')
    return refuse('The client_id must be an https address on port 443.');
  if (url.username !== '' || url.password !== '' || url.hash !== '')
    return refuse('The client_id must have no credentials or fragment.');
  if (url.pathname === '/') return refuse('The client_id must have a path.');
  if (IPV4.test(url.hostname) || url.hostname.startsWith('[') || !url.hostname.includes('.'))
    return refuse('The client_id must name a host, not an address.');
  if (url.hostname === here.hostname) return refuse('The client_id cannot be on this server.');
  return url;
}

/** At most MAX_DOCUMENT_BYTES of the body as text, or null when it is longer. */
async function boundedText(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    total += read.value.byteLength;
    if (total > MAX_DOCUMENT_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(read.value);
  }
  return new TextDecoder().decode(await new Blob(chunks as BlobPart[]).arrayBuffer());
}

/** A display name with control characters and runs of space removed, never empty. */
function displayName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const clean = Array.from(value, (ch) => (/\p{C}|\p{Z}/u.test(ch) ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return clean === '' ? fallback : clean.slice(0, NAME_MAX);
}

/** Fetches and checks the document for `clientId`; it must name itself and list allowed redirect addresses. */
export async function fetchClient(clientId: string, origin: string): Promise<Client> {
  const url = documentUrl(clientId, origin);
  let text: string | null;
  try {
    const response = await fetch(url.href, {
      redirect: 'manual',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.status !== 200)
      return refuse('The client document did not answer 200 (a redirect is not followed).');
    text = await boundedText(response);
  } catch (error) {
    if (error instanceof OauthError) throw error;
    return refuse('The client document could not be fetched in time.');
  }
  if (text === null) return refuse('The client document is larger than 5 KB.');
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return refuse('The client document is not JSON.');
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc))
    return refuse('The client document is not an object.');
  const fields = doc as Record<string, unknown>;
  if (fields.client_id !== clientId)
    return refuse('The client document does not name its own address.');
  const method = fields.token_endpoint_auth_method;
  if (method !== undefined && method !== 'none') return refuse('Only public clients are accepted.');
  const uris = fields.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECTS_LISTED)
    return refuse('The client document must list 1 to 10 redirect addresses.');
  const redirectUris = uris.filter(
    (u): u is string => typeof u === 'string' && parseRedirect(u) !== null,
  );
  if (redirectUris.length !== uris.length)
    return refuse('The client lists a redirect address that is not allowed.');
  return { id: clientId, name: displayName(fields.client_name, url.hostname), redirectUris };
}
