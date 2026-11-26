// What the settings page shows about backups and alerts: recent runs, the copy's state, where alerts go, and
// whether the setup token is still set. It reads the database and the already-parsed settings; no secret value
// leaves it, only whether one is set and the names of what is wrong.
import { recentRuns, type BackupRun } from '../db/backup-runs';
import { alertTo } from '../db/settings';
import type { CopySettings } from '../lib/env';
import { s3Target } from './s3-copy';
import { lastTestAlert, type TestAlert } from './test-alert';

/** Runs the status block lists. */
export const RUNS_SHOWN = 5;

export interface BackupStatus {
  runs: BackupRun[];
  /** `off`, `on`, or why the copy cannot work (names a setting, never a value). */
  copy: { state: 'off' | 'on' | 'broken'; detail: string };
  alertTo: string | null;
  mailOn: boolean;
  setupTokenSet: boolean;
  lastTest: (TestAlert & { at: number }) | null;
}

/** The copy as `BACKUP_COPY` and its settings describe it, by the same check the backup makes. */
export function copyState(copy: CopySettings): BackupStatus['copy'] {
  if (copy.BACKUP_COPY === 'none') {
    return { state: 'off', detail: 'Only the in-account copy is written (BACKUP_COPY is none).' };
  }
  if (copy.BACKUP_COPY !== 's3') {
    return { state: 'broken', detail: 'BACKUP_COPY is neither s3 nor none.' };
  }
  const target = s3Target(copy);
  return typeof target === 'string'
    ? { state: 'broken', detail: target }
    : { state: 'on', detail: 'Each backup is also copied to the off-account bucket.' };
}

export async function backupStatus(
  db: D1Database,
  env: { copy: CopySettings; mailOn: boolean; setupTokenSet: boolean },
): Promise<BackupStatus> {
  return {
    runs: await recentRuns(db, RUNS_SHOWN),
    copy: copyState(env.copy),
    alertTo: await alertTo(db),
    mailOn: env.mailOn,
    setupTokenSet: env.setupTokenSet,
    lastTest: await lastTestAlert(db),
  };
}
