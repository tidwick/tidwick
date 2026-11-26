// A local stand-in for an S3-compatible bucket, path-style: it checks each request's SigV4 signature, body hash
// and clock as the real API does, keeps objects in memory, and refuses writes on demand. Workers tests call its
// `fetch` directly; the restore drill serves it over HTTP on 127.0.0.1. Credentials are fresh dummies per bucket.
// Relative imports carry `.ts` so the drill runs it in Node.
import { s3Headers, sha256Hex, sign, type SigV4Key } from '../../src/backup/sigv4.ts';

const SKEW_MS = 15 * 60 * 1000;
const AUTH =
  /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=([0-9a-f]{64})$/;

/** The settings a deployment would put in the `BACKUP_S3_*` secrets for this bucket. */
export interface FakeSettings {
  endpoint: string;
  bucket: string;
  keyId: string;
  secret: string;
  region: string;
}

export interface FakeBucket {
  readonly settings: FakeSettings;
  readonly objects: Map<string, Uint8Array<ArrayBuffer>>;
  /** Every request's method and path, signed or not, in order. */
  readonly seen: string[];
  /** An HTTP status to refuse every write with, as a bucket with a revoked key or a full quota does. */
  refuse: number | null;
  fetch(request: Request): Promise<Response>;
}

const dummy = (bytes: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');

function answer(status: number, code: string): Response {
  return new Response(`<?xml version="1.0"?><Error><Code>${code}</Code></Error>`, { status });
}

/** Why `request` would be refused before any object is touched, or null when its signature holds. */
async function refusal(
  settings: FakeSettings,
  request: Request,
  body: Uint8Array<ArrayBuffer>,
  now: number,
): Promise<Response | null> {
  const auth = AUTH.exec(request.headers.get('authorization') ?? '');
  if (auth === null) return answer(403, 'AccessDenied');
  const [, keyId, day, region, signed = '', signature] = auth;
  if (keyId !== settings.keyId) return answer(403, 'InvalidAccessKeyId');
  const date = request.headers.get('x-amz-date') ?? '';
  const at = Date.parse(
    date.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, '$1-$2-$3T$4:$5:$6Z'),
  );
  if (!(Math.abs(now - at) <= SKEW_MS) || day !== date.slice(0, 8)) {
    return answer(403, 'RequestTimeTooSkewed');
  }
  const payloadHash = request.headers.get('x-amz-content-sha256') ?? '';
  if (payloadHash !== (await sha256Hex(body))) return answer(400, 'XAmzContentSHA256Mismatch');
  const names = signed.split(';');
  if (!['host', 'x-amz-content-sha256', 'x-amz-date'].every((n) => names.includes(n))) {
    return answer(403, 'AccessDenied');
  }
  const url = new URL(request.url);
  const headers = Object.fromEntries(
    names.map((n) => [n, n === 'host' ? url.host : (request.headers.get(n) ?? '')]),
  );
  const key: SigV4Key = { keyId, secret: settings.secret, region: region ?? '', service: 's3' };
  const expected = await sign(key, {
    method: request.method,
    url: request.url,
    headers,
    payloadHash,
  });
  if (region !== settings.region || expected.signature !== signature) {
    return answer(403, 'SignatureDoesNotMatch');
  }
  return null;
}

/** A bucket at `endpoint` with fresh dummy credentials, empty and accepting writes. */
export function fakeBucket(endpoint = 'https://offsite.example'): FakeBucket {
  const settings: FakeSettings = {
    endpoint,
    bucket: 'offsite-backups',
    keyId: dummy(16),
    secret: dummy(32),
    region: 'auto',
  };
  const bucket: FakeBucket = {
    settings,
    objects: new Map(),
    seen: [],
    refuse: null,
    async fetch(request) {
      const url = new URL(request.url);
      bucket.seen.push(`${request.method} ${url.pathname}`);
      const body = new Uint8Array(await request.arrayBuffer());
      if (url.origin !== new URL(settings.endpoint).origin) return answer(400, 'InvalidURI');
      const refused = await refusal(settings, request, body, Date.now());
      if (refused !== null) return refused;
      const [, name, ...rest] = url.pathname.split('/');
      if (name !== settings.bucket) return answer(404, 'NoSuchBucket');
      const key = rest.map(decodeURIComponent).join('/');
      if (request.method === 'PUT') {
        if (bucket.refuse !== null) return answer(bucket.refuse, 'AccessDenied');
        // The lock rule: a key that exists is not overwritten; a conditional PUT learns so as a 412.
        if (bucket.objects.has(key)) {
          return request.headers.get('if-none-match') === '*'
            ? answer(412, 'PreconditionFailed')
            : answer(403, 'AccessDenied');
        }
        bucket.objects.set(key, body);
        return new Response(null, { status: 200 });
      }
      const object = request.method === 'GET' ? bucket.objects.get(key) : undefined;
      return object === undefined ? answer(404, 'NoSuchKey') : new Response(object);
    },
  };
  return bucket;
}

/** Reads `key` back with a signed GET, as an operator's S3 client would; null when the bucket refuses. */
export async function readBack(
  settings: FakeSettings,
  key: string,
  fetcher: (request: Request) => Promise<Response>,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const url = `${settings.endpoint}/${settings.bucket}/${key}`;
  const sigKey = {
    keyId: settings.keyId,
    secret: settings.secret,
    region: settings.region,
    service: 's3',
  };
  const headers = await s3Headers(sigKey, 'GET', url, new Uint8Array(), Date.now());
  const response = await fetcher(new Request(url, { headers }));
  return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
}
