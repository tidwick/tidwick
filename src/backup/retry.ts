// Tries a write a few times before the run gives up on it: one transient failure should not cost a night.
// Relative imports carry `.ts` so the restore drill script can run the backup in Node.
import { errorText } from '../lib/error-text.ts';
import { DEFAULTS } from '../lib/policy-table.ts';

const pause = (ms: number): Promise<void> =>
  ms === 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `once` up to `tries` times (`BACKUP_TRIES`), pausing `pauseMs` (`BACKUP_RETRY_SECONDS`) and then longer each time, and answers null at the first success, or the
 * last failure's reason. A missing setting is not retried, since waiting will not set it. A throw counts as a failure; `once` answers null or why it did not land.
 */
export async function withRetry(
  once: () => Promise<string | null>,
  pauseMs: number = DEFAULTS.backupRetryPauseMs,
  tries: number = DEFAULTS.backupTries,
): Promise<string | null> {
  let why: string | null = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    why = await once().catch(errorText);
    if (why === null) return null;
    if (why.startsWith('missing_binding')) return why;
    if (attempt < tries) await pause(pauseMs * attempt);
  }
  return why;
}
