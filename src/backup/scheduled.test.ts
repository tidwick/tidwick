import { createScheduledController } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backupRuns } from '../db/test-support-backup';
import { recordingMailer } from '../../test/helpers/mail';
import { BACKUP_CRON, scheduled } from './scheduled';

const AT = Date.UTC(2026, 10, 18, 3);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the scheduled handler', () => {
  it('a cron it does not know runs nothing and is logged by its string', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const mailer = recordingMailer();
    await scheduled(
      createScheduledController({ cron: '0 5 * * *', scheduledTime: AT }),
      env,
      mailer,
    );
    expect(await backupRuns(env.DB)).toHaveLength(0);
    expect(mailer.sent).toHaveLength(0);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[0])).toContain('"0 5 * * *"');

    log.mockClear();
    await scheduled(
      createScheduledController({ cron: BACKUP_CRON, scheduledTime: AT }),
      env,
      mailer,
    );
    expect(await backupRuns(env.DB)).toHaveLength(1);
    expect(log).not.toHaveBeenCalled();
  });

  it('a backup cron where no BACKUPS bucket is bound, as in the demo, logs and runs nothing', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const before = (await backupRuns(env.DB)).length;
    const demo = new Proxy(env, { has: (target, key) => key !== 'BACKUPS' && key in target });
    await scheduled(createScheduledController({ cron: BACKUP_CRON, scheduledTime: AT }), demo);
    expect(log).toHaveBeenCalledTimes(1);
    expect(await backupRuns(env.DB)).toHaveLength(before);
  });

  it('an invalid knob the backup does not use still lets the 03:00 backup write its run', async () => {
    const before = (await backupRuns(env.DB)).length;
    await scheduled(createScheduledController({ cron: BACKUP_CRON, scheduledTime: AT + 1000 }), {
      ...env,
      REPORT_MAX_BARS: '500',
    });
    const runs = await backupRuns(env.DB);
    expect(runs).toHaveLength(before + 1);
    expect(runs.at(-1)).toMatchObject({ status: 'ok', error: null });
  });

  it('an invalid backup knob records a failed run naming it, writes no object, and the 09:00 check can report it', async () => {
    const at = AT + 2000;
    await scheduled(createScheduledController({ cron: BACKUP_CRON, scheduledTime: at }), {
      ...env,
      BACKUP_TRIES: '99',
    });
    const run = (await backupRuns(env.DB)).at(-1);
    expect(run?.status).toBe('failed');
    expect(run?.error).toMatch(/^missing_binding: BACKUP_TRIES /);
    expect(await env.BACKUPS.get(run?.object_key ?? '')).toBeNull();
  });
});
