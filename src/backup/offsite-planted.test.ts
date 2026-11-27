// A 409 from the bucket's lock is believed only when the object stored at the key is this run's file: a different
// object already there is never counted as the off-account copy, on the first attempt or on a retry.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { fakeBucket } from '../../test/helpers/fake-bucket';
import { readEnv } from '../lib/env';
import { objectKey, runBackup } from './export';
import { s3Copy } from './s3-copy';

const AT = Date.UTC(2026, 10, 2, 3, 0);
const DAY = 24 * 60 * 60 * 1000;

describe('SEC-15 the off-account copy under the lock', () => {
  it('SEC-15 an object already at the key that is not this backup is never counted as landed, on any attempt', async () => {
    const bucket = fakeBucket();
    const at = AT + 41 * DAY;
    bucket.objects.set(objectKey(at), new Uint8Array([9, 9, 9]));
    const deps = {
      db: env.DB,
      sink: env.BACKUPS,
      recipient: readEnv(env).BACKUP_RECIPIENT,
      retryPauseMs: 0,
    };
    // Two definite 409 answers in one run: neither is a retry of a landed PUT.
    const planted = await runBackup(
      { ...deps, copy: s3Copy(bucket.settings, (r) => bucket.fetch(r)) },
      at,
    );
    expect(planted).toMatchObject({
      status: 'failed',
      error:
        'copying off the account failed: the off-account bucket refused the write: HTTP 409 ObjectLockedByBucketPolicy',
    });
    expect(bucket.seen.filter((s) => s.startsWith('GET'))).toEqual([]);
    expect(bucket.objects.get(objectKey(at))).toEqual(new Uint8Array([9, 9, 9]));
    // A lost response, then the lock's 409: the stored object is compared and found to be another file.
    let lost = true;
    const flaky: typeof bucket.fetch = (request) => {
      if (!lost) return bucket.fetch(request);
      lost = false;
      return Promise.reject(new Error('connection reset'));
    };
    const swapped = await runBackup({ ...deps, copy: s3Copy(bucket.settings, flaky) }, at);
    expect(swapped).toMatchObject({
      status: 'failed',
      error:
        'copying off the account failed: the off-account bucket refused the write: the object already at this key is not this backup',
    });
  });
});
