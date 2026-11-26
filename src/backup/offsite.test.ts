// The off-account copy (ADR 0008) against a local fake S3-compatible bucket: the same sealed file lands
// beside the R2 one, and a refused, unsigned, unreachable or unconfigured copy is a failed run the 09:00 check
// alerts on, with no setting's value in the record or the mail.
import { Decrypter } from 'age-encryption';
import { createScheduledController } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { fakeBucket, type FakeBucket, type FakeSettings } from '../../test/helpers/fake-bucket';
import { recordingMailer } from '../../test/helpers/mail';
import { appendSyntheticEvents, backupRuns, putSetting } from '../db/test-support-backup';
import { parseBackup } from '../lib/backup-format';
import { readEnv } from '../lib/env';
import { runCheck } from './check';
import { objectKey, runBackup } from './export';
import { readHealth } from './health';
import { s3Copy } from './s3-copy';
import { BACKUP_CRON, scheduled } from './scheduled';

const IDENTITY = (env as unknown as { TEST_BACKUP_IDENTITY: string }).TEST_BACKUP_IDENTITY;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const AT = Date.UTC(2026, 10, 2, 3, 0);
const REFUSED =
  'copying off the account failed: the off-account bucket refused the write: HTTP 403 AccessDenied';

const copyVars = (s: FakeSettings) => ({
  BACKUP_COPY: 's3',
  BACKUP_S3_ENDPOINT: s.endpoint,
  BACKUP_S3_BUCKET: s.bucket,
  BACKUP_S3_KEY_ID: s.keyId,
  BACKUP_S3_SECRET: s.secret,
  BACKUP_S3_REGION: s.region,
});

async function backupAt(bucket: FakeBucket, at: number, vars: object = copyVars(bucket.settings)) {
  const controller = createScheduledController({ cron: BACKUP_CRON, scheduledTime: at });
  await scheduled(controller, { ...env, ...vars }, recordingMailer(), (r) => bucket.fetch(r), 0);
  return (await backupRuns(env.DB)).at(-1);
}

async function inR2(key: string): Promise<Uint8Array | null> {
  const object = await env.BACKUPS.get(key);
  return object === null ? null : new Uint8Array(await object.arrayBuffer());
}

beforeAll(async () => {
  await putSetting(env.DB, 'alert_to', 'ops@example.net');
  await appendSyntheticEvents(env.DB, 4, AT - DAY);
});

describe('SEC-15 the off-account copy', () => {
  it('SEC-15 the 03:00 job puts the same sealed file in R2 and in the off-account bucket, which the offline key opens', async () => {
    const bucket = fakeBucket();
    expect(await backupAt(bucket, AT)).toEqual({
      status: 'ok',
      object_key: objectKey(AT),
      error: null,
    });
    expect(bucket.seen).toEqual([`PUT /offsite-backups/${objectKey(AT)}`]);
    const copy = bucket.objects.get(objectKey(AT));
    expect(copy).toEqual(await inR2(objectKey(AT)));
    const decrypter = new Decrypter();
    decrypter.addIdentity(IDENTITY);
    const gz = new Uint8Array(await decrypter.decrypt(copy ?? new Uint8Array()));
    const text = await new Response(
      new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip')),
    ).text();
    const parsed = parseBackup(text);
    if (!parsed.ok) return expect.unreachable(parsed.why);
    expect(parsed.header.chain_seq).toBe(4);
  });

  it('SEC-15 a refused off-account write records a failed run naming the answer, keeps the R2 copy, and the 09:00 check sends one alert', async () => {
    const bucket = fakeBucket();
    bucket.refuse = 403;
    const at = AT + DAY;
    expect(await backupAt(bucket, at)).toEqual({
      status: 'failed',
      object_key: objectKey(at),
      error: REFUSED,
    });
    expect(bucket.objects.size).toBe(0);
    expect(await inR2(objectKey(at))).not.toBeNull();
    const mailer = recordingMailer();
    const result = await runCheck(env.DB, mailer, at + HOUR);
    expect(result.problems).toEqual([
      expect.stringMatching(new RegExp(`^The last backup run, at .+, failed: ${REFUSED}$`)),
    ]);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.text).toContain(REFUSED);
    expect((await readHealth(env.DB, at + HOUR)).backupAt).toBeLessThan(at);

    bucket.refuse = null;
    expect((await backupAt(bucket, at + DAY))?.status).toBe('ok');
    const quiet = recordingMailer();
    await runCheck(env.DB, quiet, at + DAY + HOUR);
    expect(quiet.sent).toEqual([]);
  });

  it('SEC-15 a copy signed with another secret is refused as a bad signature, and an unreachable or silent bucket is named without its message', async () => {
    const bucket = fakeBucket();
    const forged = s3Copy({ ...bucket.settings, secret: `${bucket.settings.secret}0` }, (r) =>
      bucket.fetch(r),
    );
    const deps = {
      db: env.DB,
      sink: env.BACKUPS,
      recipient: readEnv(env).BACKUP_RECIPIENT,
      retryPauseMs: 0,
    };
    const bad = await runBackup({ ...deps, copy: forged }, AT + 4 * DAY);
    expect(bad.error).toBe(
      'copying off the account failed: the off-account bucket refused the write: HTTP 403 SignatureDoesNotMatch',
    );
    expect(bucket.objects.size).toBe(0);
    const secret = bucket.settings.secret;
    const down = s3Copy(bucket.settings, () =>
      Promise.reject(new Error(secret, { cause: secret })),
    );
    const gone = await runBackup({ ...deps, copy: down }, AT + 5 * DAY);
    expect(gone.error).toBe(
      'copying off the account failed: the off-account bucket could not be reached: Error',
    );
    expect(JSON.stringify(await backupRuns(env.DB))).not.toContain(secret);
    const hung = s3Copy(
      bucket.settings,
      (request) =>
        new Promise((_resolve, reject) => {
          request.signal.addEventListener('abort', () => {
            reject(request.signal.reason as Error);
          });
        }),
      50,
    );
    const late = await runBackup({ ...deps, copy: hung }, AT + 7 * DAY);
    expect(late.error).toBe(
      'copying off the account failed: the off-account bucket could not be reached: TimeoutError',
    );
  });

  it('SEC-15 an R2 write that fails still sends the off-account copy, and the run names the R2 failure', async () => {
    const bucket = fakeBucket();
    const sink = { put: () => Promise.reject(new Error('r2 is down')) };
    const at = AT + 6 * DAY;
    const run = await runBackup(
      {
        db: env.DB,
        sink,
        recipient: readEnv(env).BACKUP_RECIPIENT,
        copy: s3Copy(bucket.settings, (r) => bucket.fetch(r)),
        retryPauseMs: 0,
      },
      at,
    );
    expect(run).toMatchObject({ status: 'failed', error: 'writing to the sink failed: Error' });
    expect(bucket.objects.has(objectKey(at))).toBe(true);
  });

  it('SEC-15 BACKUP_COPY s3 with any setting unset or malformed records a failed run naming it, never its value, and still writes R2', async () => {
    const bucket = fakeBucket();
    const good = copyVars(bucket.settings);
    const cases: [Partial<Record<keyof typeof good, string | undefined>>, string][] = [
      [{ BACKUP_COPY: undefined }, 'BACKUP_COPY'],
      [{ BACKUP_COPY: 'S3' }, 'BACKUP_COPY'],
      [{ BACKUP_S3_ENDPOINT: undefined }, 'BACKUP_S3_ENDPOINT'],
      [{ BACKUP_S3_ENDPOINT: 'http://offsite.example' }, 'BACKUP_S3_ENDPOINT'],
      [{ BACKUP_S3_ENDPOINT: 'https://offsite.example/path' }, 'BACKUP_S3_ENDPOINT'],
      [{ BACKUP_S3_BUCKET: 'Bad_Bucket' }, 'BACKUP_S3_BUCKET'],
      [{ BACKUP_S3_KEY_ID: '' }, 'BACKUP_S3_KEY_ID'],
      [{ BACKUP_S3_SECRET: undefined }, 'BACKUP_S3_SECRET'],
      [{ BACKUP_S3_SECRET: `${good.BACKUP_S3_SECRET} x` }, 'BACKUP_S3_SECRET'],
      [{ BACKUP_S3_REGION: undefined }, 'BACKUP_S3_REGION'],
    ];
    for (const [i, [change, name]] of cases.entries()) {
      const at = AT + (10 + i) * DAY;
      const run = await backupAt(bucket, at, { ...good, ...change });
      expect(run?.status, name).toBe('failed');
      expect(run?.error, name).toMatch(
        new RegExp(`^copying off the account failed: missing_binding: ${name} `),
      );
      expect(run?.error).not.toContain(good.BACKUP_S3_SECRET);
      expect(await inR2(objectKey(at)), name).not.toBeNull();
    }
    expect(bucket.seen).toEqual([]);
  });

  it('BACKUP_COPY none writes R2 alone and sends no request', async () => {
    const bucket = fakeBucket();
    const at = AT + 30 * DAY;
    expect((await backupAt(bucket, at, { BACKUP_COPY: 'none' }))?.status).toBe('ok');
    expect(bucket.seen).toEqual([]);
  });

  it('SEC-15 a retry after a PUT that landed with its response lost counts as landed, and a refusal with nothing landed still fails', async () => {
    const bucket = fakeBucket();
    let lost = true;
    const flaky: typeof bucket.fetch = async (request) => {
      const response = await bucket.fetch(request);
      if (!lost) return response;
      lost = false;
      throw new Error('connection reset');
    };
    const at = AT + 40 * DAY;
    const deps = {
      db: env.DB,
      sink: env.BACKUPS,
      recipient: readEnv(env).BACKUP_RECIPIENT,
      retryPauseMs: 0,
    };
    const run = await runBackup({ ...deps, copy: s3Copy(bucket.settings, flaky) }, at);
    expect(run).toMatchObject({ status: 'ok', error: null });
    expect(bucket.seen).toEqual(Array(2).fill(`PUT /offsite-backups/${objectKey(at)}`));
    // A first write over an existing object is not a retry: it meets the lock's refusal.
    const again = s3Copy(bucket.settings, (r) => bucket.fetch(r));
    expect(await again.write(objectKey(at), new Uint8Array([1]))).toBe(
      'the off-account bucket refused the write: HTTP 409 ObjectLockedByBucketPolicy',
    );
  });
});
