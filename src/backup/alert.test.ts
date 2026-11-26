import { createScheduledController } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { backupRuns, putSetting } from '../db/test-support-backup';
import { recordingMailer } from '../../test/helpers/mail';
import { BACKUP_CRON, CHECK_CRON, scheduled } from './scheduled';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const DAY_ONE = Date.UTC(2026, 10, 18);

const at = (day: number, hour: number) => DAY_ONE + day * DAY + hour * HOUR;
const tick = (cron: string, time: number) =>
  createScheduledController({ cron, scheduledTime: time });

/** The real env with a sink that refuses every write, as an outage or a revoked binding would. */
function withDeadSink(): object {
  const dead = {
    put: () => Promise.reject(new TypeError('sink unavailable')),
    get: () => Promise.resolve(null),
    list: () => Promise.resolve({ objects: [] }),
  };
  return { ...env, BACKUPS: dead };
}

describe('a missed backup sends one alert', () => {
  beforeAll(async () => {
    await putSetting(env.DB, 'alert_to', 'ops@example.net');
    await scheduled(tick(BACKUP_CRON, at(0, 3)), env);
  });

  it('a backup that ran at 03:00 leaves the 09:00 check silent', async () => {
    const mailer = recordingMailer();
    await scheduled(tick(CHECK_CRON, at(0, 9)), env, mailer);
    expect(mailer.sent).toEqual([]);
  });

  it('a missed backup sends exactly one alert, from the 09:00 check alone', async () => {
    const mailer = recordingMailer();
    await scheduled(tick(BACKUP_CRON, at(1, 3)), withDeadSink(), mailer, undefined, 0);
    expect(mailer.sent).toEqual([]);
    const runs = await backupRuns(env.DB);
    expect(runs.at(-1)).toEqual({
      status: 'failed',
      object_key: 'backups/2026/11/19-030000.ndjson.gz.age',
      error: 'writing to the sink failed: TypeError',
    });
    expect(await env.BACKUPS.get('backups/2026/11/19-030000.ndjson.gz.age')).toBeNull();
    // At 09:00 the day-one backup is 30 hours old, past the 26 hour default.
    await scheduled(tick(CHECK_CRON, at(1, 9)), env, mailer);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({
      to: 'ops@example.net',
      subject: 'tidwick: backup or audit check failed',
    });
    expect(mailer.sent[0]?.text).toContain('30 hours ago, past the 26 hour limit');
  });

  it('the next good backup ends the alerts', async () => {
    const mailer = recordingMailer();
    await scheduled(tick(BACKUP_CRON, at(2, 3)), env, mailer);
    await scheduled(tick(CHECK_CRON, at(2, 9)), env, mailer);
    expect(mailer.sent).toEqual([]);
  });

  it('with no alert address saved the check sends nothing', async () => {
    await putSetting(env.DB, 'alert_to', null);
    const mailer = recordingMailer();
    await scheduled(tick(CHECK_CRON, at(4, 9)), env, mailer);
    expect(mailer.sent).toEqual([]);
  });
});
