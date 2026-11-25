// The off-account copy (ADR 0008): the sealed backup PUT to an S3-compatible bucket, path-style, signed
// with SigV4. A write answers why it did not land in fixed words instead of throwing, so a refused or unreachable
// bucket becomes the run's recorded reason and the 09:00 alert. Relative imports carry `.ts` for the Node drill.
import type { CopySettings } from '../lib/env.ts';
import { errorText } from '../lib/error-text.ts';
import type { BackupCopy } from './export.ts';
import { s3Headers, uriEncode } from './sigv4.ts';

/** Where the copy goes and the access key scoped to that one bucket. */
export interface S3Target {
  readonly endpoint: string;
  readonly bucket: string;
  readonly keyId: string;
  readonly secret: string;
  readonly region: string;
}

export type Fetcher = (request: Request) => Promise<Response>;

/** How long one PUT may take before the run records the bucket as unreachable, well inside the cron's limit. */
export const COPY_TIMEOUT_MS = 2 * 60 * 1000;

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** An `https://` origin with no path, or `http://` on this machine for a local fake. */
function isEndpoint(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  const secure =
    url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname));
  return secure && url.origin === value;
}

const SHAPES: readonly [keyof CopySettings, (value: string) => boolean, string][] = [
  [
    'BACKUP_S3_ENDPOINT',
    isEndpoint,
    "an https:// origin with no path, the bucket's S3 API endpoint",
  ],
  ['BACKUP_S3_BUCKET', (v) => /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(v), 'a bucket name'],
  ['BACKUP_S3_KEY_ID', (v) => /^[A-Za-z0-9_-]{1,128}$/.test(v), 'an access key id'],
  ['BACKUP_S3_SECRET', (v) => /^\S{1,256}$/.test(v), 'a secret access key'],
  ['BACKUP_S3_REGION', (v) => /^[a-z0-9-]{1,32}$/.test(v), 'a region such as auto'],
];

/** The target `settings` describe, or why they cannot, naming the first setting at fault and never its value. */
export function s3Target(settings: CopySettings): S3Target | string {
  for (const [name, valid, shape] of SHAPES) {
    if (!valid(settings[name])) {
      return `missing_binding: ${name} is unset or not ${shape}; set it as docs/ARCHITECTURE.md, Deploy, says`;
    }
  }
  return {
    endpoint: settings.BACKUP_S3_ENDPOINT,
    bucket: settings.BACKUP_S3_BUCKET,
    keyId: settings.BACKUP_S3_KEY_ID,
    secret: settings.BACKUP_S3_SECRET,
    region: settings.BACKUP_S3_REGION,
  };
}

/** A refusal in fixed words: the status and the S3 error code, never the rest of the body. */
function refused(status: number, body: string): string {
  const code = /<Code>([A-Za-z]{1,40})<\/Code>/.exec(body)?.[1];
  return `the off-account bucket refused the write: HTTP ${String(status)}${code === undefined ? '' : ` ${code}`}`;
}

/** Writes each backup to `target` through `fetcher`, answering null once the bucket has taken it. */
export function s3Copy(
  target: S3Target,
  fetcher: Fetcher,
  timeoutMs = COPY_TIMEOUT_MS,
): BackupCopy {
  const key = { keyId: target.keyId, secret: target.secret, region: target.region, service: 's3' };
  return {
    async write(objectKey, sealed) {
      const body = new Uint8Array(sealed);
      const url = `${target.endpoint}/${target.bucket}/${objectKey.split('/').map(uriEncode).join('/')}`;
      try {
        const headers = await s3Headers(key, 'PUT', url, body, Date.now());
        const signal = AbortSignal.timeout(timeoutMs);
        const response = await fetcher(new Request(url, { method: 'PUT', headers, body, signal }));
        const text = await response.text();
        return response.ok ? null : refused(response.status, text);
      } catch (error) {
        return `the off-account bucket could not be reached: ${errorText(error)}`;
      }
    },
  };
}

/**
 * The copy `BACKUP_COPY` asks for: null for `none`; for `s3`, the bucket the settings name, or, when they are
 * unusable, a copy that writes nothing and answers why, so the run still writes R2 and records the reason.
 */
export function offsiteCopy(settings: CopySettings, fetcher: Fetcher): BackupCopy | null {
  if (settings.BACKUP_COPY === 'none') return null;
  const target =
    settings.BACKUP_COPY === 's3'
      ? s3Target(settings)
      : 'missing_binding: BACKUP_COPY is neither s3 nor none; set it in wrangler.jsonc vars';
  if (typeof target !== 'string') return s3Copy(target, fetcher);
  return { write: () => Promise.resolve(target) };
}
