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
});
