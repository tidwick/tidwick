// The Worker's `scheduled` handler: 03:00 UTC writes the backup, 09:00 UTC checks it and the audit chain.
import { demoMarked } from '../db/demo';
import { wipeDemo } from '../db/demo-wipe';
import { backupEnv, checkEnv, readEnv } from '../lib/env';
import { bindingMailer, type Mailer } from '../lib/mail';
import { runCheck } from './check';
import { runBackup } from './export';
import { offsiteCopy, type Fetcher } from './s3-copy';

export const BACKUP_CRON = '0 3 * * *';
export const CHECK_CRON = '0 9 * * *';
/** The demo Worker's only cron: the nightly wipe back to the seed (wrangler.jsonc env.demo). */
export const DEMO_RESET_CRON = '0 4 * * *';

/**
 * Runs the job for `controller.cron`, and logs a cron it does not know; in tests `mailer` replaces the send-email
 * binding and `fetcher` the network the off-account copy goes out on, `retryPauseMs` the wait between a write's tries. With `MAIL` off the check gets no mailer.
 */
export async function scheduled(
  controller: ScheduledController,
  source: object,
  mailer?: Mailer,
  fetcher: Fetcher = (request) => fetch(request),
  retryPauseMs?: number,
): Promise<void> {
  if (controller.cron === BACKUP_CRON && !('BACKUPS' in source)) {
    console.error('tidwick: no BACKUPS bucket is bound here; the backup did not run');
  } else if (controller.cron === BACKUP_CRON) {
    const env = backupEnv(source);
    await runBackup(
      {
        db: env.DB,
        sink: env.BACKUPS,
        recipient: env.BACKUP_RECIPIENT,
        copy: offsiteCopy(env.copy, fetcher),
        ...(retryPauseMs === undefined ? {} : { retryPauseMs }),
      },
      controller.scheduledTime,
    );
  } else if (controller.cron === CHECK_CRON) {
    const env = checkEnv(source);
    const sender = env.mail === null ? null : bindingMailer(env.mail.EMAIL, env.mail.MAIL_FROM);
    await runCheck(env.DB, mailer ?? sender, controller.scheduledTime);
  } else if (controller.cron === DEMO_RESET_CRON) {
    const env = readEnv(source);
    // Wipes while the DB carries the marker and the demo is meant to be on, so closing the sign-in gate (no
    // password) never leaves a visitor's changes in place.
    if ((env.DEMO_LOGIN || env.DEMO_BANNER) && (await demoMarked(env.DB)))
      await wipeDemo(env.DB, env.NOTE_KEK, controller.scheduledTime);
    else
      console.error(
        'tidwick: the demo reset runs only where the demo gate holds; nothing was reset',
      );
  } else {
    console.error(
      `tidwick: cron "${controller.cron}" runs nothing; wrangler.jsonc triggers.crons must be "${BACKUP_CRON}" and "${CHECK_CRON}"`,
    );
  }
}
