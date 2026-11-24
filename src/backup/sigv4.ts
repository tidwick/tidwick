// AWS Signature Version 4 on WebCrypto alone, for requests to an S3-compatible bucket (ADR 0008). It is checked
// against AWS's published vectors in `sigv4.test.ts`. No imports, so the restore drill runs it in Node.

const encoder = new TextEncoder();
const UNRESERVED = /^[A-Za-z0-9\-._~]$/;

const hex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

/** Hex SHA-256 of `data`, the form SigV4 uses for the payload and the canonical request. */
export async function sha256Hex(data: Uint8Array<ArrayBuffer> | string): Promise<string> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  return hex(await crypto.subtle.digest('SHA-256', bytes));
}

async function hmac(
  key: Uint8Array<ArrayBuffer> | ArrayBuffer,
  data: string,
): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', imported, encoder.encode(data));
}

/** Percent-encodes every UTF-8 byte outside RFC 3986's unreserved set, in upper-case hex. */
export function uriEncode(text: string): string {
  return Array.from(encoder.encode(text), (byte) => {
    const char = String.fromCharCode(byte);
    return UNRESERVED.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }).join('');
}

/** Each path segment decoded once and encoded once, as S3 signs it: no dot-segment folding, `/` kept. */
function canonicalPath(pathname: string): string {
  return pathname === ''
    ? '/'
    : pathname
        .split('/')
        .map((s) => uriEncode(decodeURIComponent(s)))
        .join('/');
}

/** Every `name=value` pair encoded, sorted by name then value; a bare name signs as `name=`. */
function canonicalQuery(search: string): string {
  if (search.length <= 1) return '';
  return search
    .slice(1)
    .split('&')
    .filter((pair) => pair !== '')
    .map((pair) => {
      const at = pair.indexOf('=');
      const [name, value] = at === -1 ? [pair, ''] : [pair.slice(0, at), pair.slice(at + 1)];
      return [uriEncode(decodeURIComponent(name)), uriEncode(decodeURIComponent(value))] as const;
    })
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
}

/** Who signs and for what: the access key pair, the region and the service (`s3` for a bucket). */
export interface SigV4Key {
  readonly keyId: string;
  readonly secret: string;
  readonly region: string;
  readonly service: string;
}

/** One request to sign. `headers` holds every header to sign, `host` and `x-amz-date` among them. */
export interface SigV4Request {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  /** Hex SHA-256 of the body. */
  readonly payloadHash: string;
}

export interface SigV4Signed {
  readonly canonicalRequest: string;
  readonly stringToSign: string;
  readonly signature: string;
  readonly authorization: string;
}

/** Signs `request` with `key` at the instant its `x-amz-date` header names. */
export async function sign(key: SigV4Key, request: SigV4Request): Promise<SigV4Signed> {
  const url = new URL(request.url);
  const headers = Object.entries(request.headers)
    .map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const datetime = headers.find(([name]) => name === 'x-amz-date')?.[1] ?? '';
  const signedHeaders = headers.map(([name]) => name).join(';');
  const canonicalRequest = [
    request.method,
    canonicalPath(url.pathname),
    canonicalQuery(url.search),
    ...headers.map(([name, value]) => `${name}:${value}`),
    '',
    signedHeaders,
    request.payloadHash,
  ].join('\n');
  const scope = `${datetime.slice(0, 8)}/${key.region}/${key.service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    datetime,
    scope,
    await sha256Hex(canonicalRequest),
  ].join('\n');
  let signing = await hmac(encoder.encode(`AWS4${key.secret}`), datetime.slice(0, 8));
  for (const part of [key.region, key.service, 'aws4_request']) signing = await hmac(signing, part);
  const signature = hex(await hmac(signing, stringToSign));
  const authorization = `AWS4-HMAC-SHA256 Credential=${key.keyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { canonicalRequest, stringToSign, signature, authorization };
}

/** `YYYYMMDDTHHMMSSZ` for `now`, the form of `x-amz-date`. */
export function amzDate(now: number): string {
  return new Date(now)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/**
 * The headers to send with one S3 request at `now`: `x-amz-date`, `x-amz-content-sha256` and `authorization`,
 * signed over those two and `host`, which `fetch` sets from the URL.
 */
export async function s3Headers(
  key: SigV4Key,
  method: string,
  url: string,
  body: Uint8Array<ArrayBuffer>,
  now: number,
): Promise<Record<string, string>> {
  const sent = { 'x-amz-date': amzDate(now), 'x-amz-content-sha256': await sha256Hex(body) };
  const { authorization } = await sign(key, {
    method,
    url,
    headers: { host: new URL(url).host, ...sent },
    payloadHash: sent['x-amz-content-sha256'],
  });
  return { ...sent, authorization };
}
