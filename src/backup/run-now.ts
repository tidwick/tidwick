// The admin's "Back up now": the nightly backup, run on request and audited. A failed run is recorded like a
// nightly one, with its reason, and is not an error here, so the status block shows it.
import { appendEvent } from '../db/audit';
import type { BackupRun } from '../db/backup-runs';
import type { Scope } from '../db/scope';
import { backupEnv } from '../lib/env';
import { fail } from '../lib/errors';
import { runBackup } from './export';
import { offsiteCopy, type Fetcher } from './s3-copy';

/** Runs one backup as `scope`'s admin and appends `backup.run` with the run's key, status and reason. */
export async function backUpNow(
  scope: Scope,
  env: ReturnType<typeof backupEnv>,
  now: number,
  fetcher: Fetcher = (request) => fetch(request),
): Promise<BackupRun> {
  if (scope.kind !== 'all') fail('forbidden');
  const run = await runBackup(
    {
      db: env.DB,
      sink: env.BACKUPS,
      recipient: env.BACKUP_RECIPIENT,
      copy: offsiteCopy(env.copy, fetcher),
    },
    now,
  );
  await appendEvent(scope, env.DB, {
    at: now,
    action: 'backup.run',
    clientId: null,
    target: `backup_run:${run.id}`,
    after: { status: run.status, object_key: run.object_key, error: run.error },
  });
  return run;
}
