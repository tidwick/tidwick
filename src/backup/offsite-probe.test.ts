// `just offsite-check` against fake buckets: a locked, scoped one passes; each missing guard fails by name.
import { describe, expect, it } from 'vitest';
import { probeOffsite } from './offsite-probe';
import type { Fetcher, S3Target } from './s3-copy';

const TARGET: S3Target = {
  endpoint: 'https://acct.r2.example.test',
  bucket: 'offsite-backups',
  keyId: 'AKIAEXAMPLE',
  secret: 'secret-example',
  region: 'auto',
};

/** A bucket that answers like R2: `locked` refuses a second PUT and a DELETE, `scoped` refuses the account listing. */
function bucket(opts: { locked: boolean; scoped: boolean }): Fetcher {
  const held = new Set<string>();
  return (request) => {
    const { pathname } = new URL(request.url);
    const deny = () =>
      Promise.resolve(new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 }));
    const ok = () => Promise.resolve(new Response('', { status: 200 }));
    if (pathname === '/') return opts.scoped ? deny() : ok();
    if (request.method === 'PUT') {
      if (opts.locked && held.has(pathname)) return deny();
      held.add(pathname);
      return ok();
    }
    if (request.method === 'DELETE') return opts.locked ? deny() : ok();
    return deny();
  };
}

const failed = async (fetcher: Fetcher) =>
  (await probeOffsite(TARGET, fetcher, Date.UTC(2026, 10, 25)))
    .filter((r) => !r.ok)
    .map((r) => r.name);

describe('probeOffsite', () => {
  it('passes a locked bucket reached with a bucket-scoped key', async () => {
    expect(await failed(bucket({ locked: true, scoped: true }))).toEqual([]);
  });

  it('fails an unlocked bucket on overwrite and delete, naming the lock rule', async () => {
    const results = await probeOffsite(TARGET, bucket({ locked: false, scoped: true }), 1);
    expect(results.filter((r) => !r.ok).map((r) => r.name)).toEqual([
      'overwrite refused',
      'delete refused',
    ]);
    expect(results[1]?.why).toContain('lock rule');
  });

  it('fails a key that can list the account', async () => {
    expect(await failed(bucket({ locked: true, scoped: false }))).toEqual([
      'account listing refused',
    ]);
  });

  it('fails every probe, without throwing, when the bucket cannot be reached', async () => {
    const down: Fetcher = () => Promise.reject(new TypeError('connect refused'));
    expect(await failed(down)).toHaveLength(4);
  });
});
