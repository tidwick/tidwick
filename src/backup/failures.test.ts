// The backup's failure modes: a missing or malformed recipient, a sink or database error carrying a secret, and a
// clock that puts the last good run in the future. Each ends in a recorded run and one alert, never in silence.
import { createScheduledController } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { recordingMailer } from '../../test/helpers/mail';
import { secrets } from '../../test/helpers/probe-secrets';
import { failingDb } from '../db/test-support';
import { appendSyntheticEvents, backupRuns, putSetting } from '../db/test-support-backup';
import { readEnv } from '../lib/env';
import { runCheck } from './check';
import { objectKey, runBackup } from './export';
import { CLOCK_SKEW_MS, readHealth } from './health';
import { BACKUP_CRON, scheduled } from './scheduled';

const HOUR = 60 * 60 * 1000;
const AT = Date.UTC(2026, 10, 10, 3, 0);
const deps = () => ({ db: env.DB, sink: env.BACKUPS, recipient: readEnv(env).BACKUP_RECIPIENT });

beforeAll(async () => {
  await putSetting(env.DB, 'alert_to', 'ops@example.net');
  await appendSyntheticEvents(env.DB, 3, AT - HOUR);
});

describe('SEC-15 backup failure modes', () => {
  it('SEC-15 a missing or malformed recipient records a failed run with the reason, writes no file, and the 09:00 check alerts', async () => {
    const cases: [object, number][] = [
      [{ ...env, BACKUP_RECIPIENT: undefined }, AT],
      [{ ...env, BACKUP_RECIPIENT: 'age1notarecipient' }, AT + 24 * HOUR],
    ];
    for (const [source, time] of cases) {
      await scheduled(
        createScheduledController({ cron: BACKUP_CRON, scheduledTime: time }),
        source,
      );
      expect((await backupRuns(env.DB)).at(-1)).toEqual({
        status: 'failed',
        object_key: objectKey(time),
        error:
          'missing_binding: BACKUP_RECIPIENT is not an age public key; set it from the offline kit',
      });
      expect(await env.BACKUPS.get(objectKey(time))).toBeNull();
    }
    const mailer = recordingMailer();
    await runCheck(env.DB, mailer, AT + 30 * HOUR);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.text).toContain('No backup has succeeded yet.');
  });

  it('SEC-15 a sink or database error carrying a secret leaves none of it in the run record or the alert', async () => {
    for (const [kind, secret] of Object.entries(secrets())) {
      const sink = { put: () => Promise.reject(new Error(secret, { cause: secret })) };
      const run = await runBackup({ ...deps(), sink }, AT + 48 * HOUR);
      expect(run.error, kind).toBe('writing to the sink failed: Error');
      const broken = failingDb(env.DB, 'FROM audit_event WHERE seq > ?1', `D1_ERROR: ${secret}`);
      const mailer = recordingMailer();
      const result = await runCheck(broken, mailer, AT + 72 * HOUR);
      expect(result.problems).toContain('The check could not finish: Error D1_ERROR');
      expect(JSON.stringify(mailer.sent), kind).not.toContain(secret);
      expect(JSON.stringify(await backupRuns(env.DB)), kind).not.toContain(secret);
    }
  });

  it('SEC-28 the age limit holds at exactly backup_max_age_hours and fires one alert just past it, in the check and /healthz alike', async () => {
    const run = await runBackup(deps(), AT + 96 * HOUR);
    expect(run.status).toBe('ok');
    const limit = run.finished_at + 26 * HOUR;
    for (const [now, fresh] of [
      [limit, true],
      [limit + 1, false],
    ] as const) {
      const mailer = recordingMailer();
      await runCheck(env.DB, mailer, now);
      expect(mailer.sent, String(now)).toHaveLength(fresh ? 0 : 1);
      expect((await readHealth(env.DB, now)).ok).toBe(fresh);
    }
  });

  it('SEC-28 a good run dated in the future sends one alert and turns /healthz 503, and one inside the skew allowance does not', async () => {
    const latest = (await readHealth(env.DB, AT)).body.backup_at ?? 0;
    const ahead = recordingMailer();
    const result = await runCheck(env.DB, ahead, latest - 2 * HOUR);
    expect(ahead.sent).toHaveLength(1);
    expect(result.problems).toEqual([
      'The last good backup says it finished 120 minutes from now; check the clock and the backup_run rows, since a future-dated run hides every backup after it.',
    ]);
    expect((await readHealth(env.DB, latest - 2 * HOUR)).ok).toBe(false);
    const within = recordingMailer();
    await runCheck(env.DB, within, latest - CLOCK_SKEW_MS);
    expect(within.sent).toEqual([]);
    expect((await readHealth(env.DB, latest - CLOCK_SKEW_MS)).ok).toBe(true);
  });
});
