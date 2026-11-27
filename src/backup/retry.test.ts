// A transient write failure is retried inside the run, the key keeps two backups of one day apart, and "Back up
// now" and the test alert are audited with the reason a failure gives.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { adminScope } from '../../test/helpers/auth';
import { recordingMailer } from '../../test/helpers/mail';
import { eventsAfter, headSeq, memberScope } from '../../test/helpers/reference';
import { backupRuns } from '../db/test-support-backup';
import { backupEnv } from '../lib/env';
import { objectKey, runBackup, type BackupCopy, type BackupSink } from './export';
import { backUpNow } from './run-now';
import { BACKUP_CRON, scheduled } from './scheduled';
import { DEFAULT_POLICY, readPolicy } from '../lib/policy';
import { withRetry } from './retry';
import { lastTestAlert, sendTestAlert } from './test-alert';

const AT = Date.UTC(2026, 10, 12, 3, 0, 7);
const deps = (sink: BackupSink, copy: BackupCopy | null = null) => ({
  db: env.DB,
  sink,
  recipient: backupEnv(env).BACKUP_RECIPIENT,
  copy,
  retryPauseMs: 0,
});

describe('backup retry and key', () => {
  it('names a backup by its UTC time, so two on one day differ', () => {
    expect(objectKey(AT)).toBe('backups/2026/11/12-030007.ndjson.gz.age');
    expect(objectKey(AT + 60_000)).not.toBe(objectKey(AT));
  });

  it('withRetry stops at the first success and answers the last reason after the last try', async () => {
    let calls = 0;
    expect(await withRetry(() => Promise.resolve(++calls < 3 ? 'no' : null), 0)).toBeNull();
    expect(calls).toBe(3);
    calls = 0;
    expect(await withRetry(() => Promise.resolve(`no ${String(++calls)}`), 0)).toBe('no 3');
    expect(await withRetry(() => Promise.reject(new Error('boom')), 0)).toBe('Error');
    calls = 0;
    expect(await withRetry(() => Promise.resolve((calls++, 'missing_binding: X')), 0)).toBe(
      'missing_binding: X',
    );
    expect(calls).toBe(1);
    expect(DEFAULT_POLICY.backupTries).toBe(3);
  });

  it('a sink that fails twice then lands records an ok run, and one that never lands records failed', async () => {
    let puts = 0;
    const flaky: BackupSink = {
      put: (key, value) =>
        ++puts < 3 ? Promise.reject(new Error('r2 5xx')) : env.BACKUPS.put(key, value),
    };
    const ok = await runBackup(deps(flaky), AT);
    expect([ok.status, ok.error, puts]).toEqual(['ok', null, 3]);
    expect(await env.BACKUPS.get(objectKey(AT))).not.toBeNull();

    puts = 0;
    const dead: BackupSink = { put: () => (puts++, Promise.reject(new Error('r2 down'))) };
    const failed = await runBackup(deps(dead), AT + 1000);
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('writing to the sink failed: Error');
    expect(puts).toBe(3);
  });

  it('a copy that fails once then lands leaves the run ok', async () => {
    let writes = 0;
    const copy = { write: () => Promise.resolve(++writes < 2 ? 'bucket 503' : null) };
    const run = await runBackup(deps(env.BACKUPS, copy), AT + 2000);
    expect([run.status, writes]).toEqual(['ok', 2]);
  });
});

describe('Back up now', () => {
  it('runs a backup and appends backup.run naming the run, and refuses a member scope', async () => {
    const before = await headSeq();
    const run = await backUpNow(await adminScope(), backupEnv(env), AT + 5000);
    expect(run.status).toBe('ok');
    expect((await backupRuns(env.DB)).some((r) => r.object_key === run.object_key)).toBe(true);
    const [event] = await eventsAfter(before);
    expect(event?.action).toBe('backup.run');
    expect(event?.target).toBe(`backup_run:${run.id}`);
    expect(JSON.parse(event?.after_json ?? '{}')).toMatchObject({ status: 'ok' });

    const head = await headSeq();
    await expect(backUpNow((await memberScope()).scope, backupEnv(env), AT)).rejects.toThrow();
    expect(await headSeq()).toBe(head);
  });

  it('a failed run is recorded and audited with its reason, not thrown', async () => {
    const run = await backUpNow(
      await adminScope(),
      { ...backupEnv(env), BACKUP_RECIPIENT: 'nope' },
      AT + 9000,
    );
    expect(run.status).toBe('failed');
    expect(run.error).toContain('BACKUP_RECIPIENT');
  });

  it('an invalid backup knob is a failed run naming it, also on demand', async () => {
    const run = await backUpNow(
      await adminScope(),
      backupEnv({ ...env, BACKUP_TRIES: 'x' }),
      AT + 9500,
    );
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/^missing_binding: BACKUP_TRIES /);
  });
});

describe('Send test alert', () => {
  it('sends one mail to alert_to and audits it, or says why none went, always as one event', async () => {
    const admin = await adminScope();
    const none = await sendTestAlert(admin, env.DB, recordingMailer(), AT);
    expect(none.error).toContain('No alert address');
    await env.DB.exec(
      `INSERT INTO setting (key, value_json) VALUES ('alert_to', '"ops@example.net"') ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json;`,
    );

    const mailer = recordingMailer();
    expect(await sendTestAlert(admin, env.DB, mailer, AT + 61_000)).toEqual({
      sent: true,
      error: null,
    });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe('ops@example.net');
    expect(await lastTestAlert(env.DB)).toMatchObject({ at: AT + 61_000, sent: true });

    const off = await sendTestAlert(admin, env.DB, null, AT + 130_000);
    expect(off.error).toContain('Email is off');
    const refusing = { send: () => Promise.reject(new Error('destination address not verified')) };
    const before = await headSeq();
    const refused = await sendTestAlert(admin, env.DB, refusing, AT + 200_000);
    expect(refused).toEqual({
      sent: false,
      error: 'The mail binding refused it: Error',
    });
    expect(await eventsAfter(before)).toHaveLength(1);
    expect(await lastTestAlert(env.DB)).toMatchObject({ at: AT + 200_000, sent: false });

    // A second send inside the cooldown is refused: no mail, no event.
    const quick = recordingMailer();
    const head = await headSeq();
    await expect(sendTestAlert(admin, env.DB, quick, AT + 200_001)).rejects.toThrow();
    expect(quick.sent).toHaveLength(0);
    expect(await eventsAfter(head)).toHaveLength(0);

    await expect(sendTestAlert((await memberScope()).scope, env.DB, mailer, AT)).rejects.toThrow();
  });

  it('BACKUP_TRIES: a write gets the configured number of tries, the first included', async () => {
    const tries = readPolicy({ BACKUP_TRIES: '2' }).backupTries;
    let puts = 0;
    const dead: BackupSink = { put: () => (puts++, Promise.reject(new Error('r2 down'))) };
    const run = await runBackup({ ...deps(dead), tries }, AT + 3000);
    expect([run.status, puts]).toEqual(['failed', 2]);
    let calls = 0;
    expect(await withRetry(() => Promise.resolve(`no ${String(++calls)}`), 0, 1)).toBe('no 1');
  });

  it('BACKUP_RETRY_SECONDS: the pause before a second try is the configured one, longer before the third', async () => {
    const pauseMs = readPolicy({ BACKUP_RETRY_SECONDS: '0' }).backupRetryPauseMs;
    expect(pauseMs).toBe(0);
    const slow = readPolicy({ BACKUP_RETRY_SECONDS: '1' }).backupRetryPauseMs;
    expect(slow).toBe(1000);
    const waits: number[] = [];
    const real = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      waits.push(ms ?? 0);
      return real(fn, 0);
    }) as typeof setTimeout;
    try {
      expect(await withRetry(() => Promise.resolve('no'), slow, 3)).toBe('no');
    } finally {
      globalThis.setTimeout = real;
    }
    expect(waits).toEqual([1000, 2000]);
  });

  it('the 03:00 cron and "Back up now" use the deploy\'s BACKUP_TRIES and BACKUP_RETRY_SECONDS', async () => {
    let puts = 0;
    const dead = {
      put: () => (puts++, Promise.reject(new Error('r2 down'))),
      get: () => Promise.resolve(null),
      list: () => Promise.resolve({ objects: [] }),
    };
    const source = { ...env, BACKUPS: dead, BACKUP_TRIES: '2', BACKUP_RETRY_SECONDS: '0' };
    await scheduled({ cron: BACKUP_CRON, scheduledTime: AT + 4000 } as ScheduledController, source);
    expect(puts).toBe(2);
    puts = 0;
    await backUpNow(await adminScope(), backupEnv(source), AT + 5000);
    expect(puts).toBe(2);
  });
});
