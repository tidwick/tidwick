// What `just offsite-check` asks of the off-account bucket with the key the Worker holds (ADR 0008): it takes a
// write, refuses to overwrite or delete it (the lock rule), and refuses to list the account's buckets (the token's
// scope). Relative imports carry `.ts` for the Node script.
import { type Fetcher, type S3Target } from './s3-copy.ts';
import { s3Headers, uriEncode } from './sigv4.ts';

export interface ProbeResult {
  readonly name: string;
  readonly ok: boolean;
  readonly why: string;
}

/** Runs the probes in order. A probe that cannot reach the bucket is a failed probe with the reason, never a throw. */
export async function probeOffsite(
  target: S3Target,
  fetcher: Fetcher,
  now: number,
): Promise<ProbeResult[]> {
  const key = { keyId: target.keyId, secret: target.secret, region: target.region, service: 's3' };
  const object = `${target.endpoint}/${target.bucket}/offsite-check/${uriEncode(String(now))}.txt`;
  async function send(method: string, url: string, text: string): Promise<number | string> {
    const body = new TextEncoder().encode(text);
    try {
      const headers = await s3Headers(key, method, url, body, now);
      const init = method === 'PUT' ? { body } : {};
      const response = await fetcher(new Request(url, { method, headers, ...init }));
      await response.text();
      return response.status;
    } catch {
      return 'the bucket could not be reached';
    }
  }
  const verdict = (name: string, status: number | string, wantOk: boolean, fix: string) => {
    const ok = typeof status === 'number' && (status >= 200 && status < 300) === wantOk;
    const seen = typeof status === 'number' ? `HTTP ${String(status)}` : status;
    return { name, ok, why: ok ? seen : `${seen}; ${fix}` };
  };
  return [
    verdict(
      'write',
      await send('PUT', object, 'tidwick offsite-check'),
      true,
      'check BACKUP_S3_ENDPOINT, the bucket name and that the token may write to it',
    ),
    verdict(
      'overwrite refused',
      await send('PUT', object, 'overwritten'),
      false,
      'add the lock rule: wrangler r2 bucket lock add <bucket> (docs/ARCHITECTURE.md, Deploy)',
    ),
    verdict(
      'delete refused',
      await send('DELETE', object, ''),
      false,
      'add the lock rule, and give the token write access only, not delete',
    ),
    verdict(
      'account listing refused',
      await send('GET', `${target.endpoint}/`, ''),
      false,
      'scope the R2 token to this one bucket, not the account',
    ),
  ];
}
