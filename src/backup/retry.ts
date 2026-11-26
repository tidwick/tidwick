// Tries a write a few times before the run gives up on it: one transient failure should not cost a night.
// Relative imports carry `.ts` so the restore drill script can run the backup in Node.
import { errorText } from '../lib/error-text.ts';

/** Tries one write makes, the first included. */
export const WRITE_TRIES = 3;

/** Pause before the second and third try; tests pass 0. */
export const RETRY_PAUSE_MS = 2000;

const pause = (ms: number): Promise<void> =>
  ms === 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `once` up to `WRITE_TRIES` times, pausing longer each time, and answers null at the first success, or the
 * last failure's reason. A missing setting is not retried, since waiting will not set it. A throw counts as a failure; `once` answers null or why it did not land.
 */
export async function withRetry(
  once: () => Promise<string | null>,
  pauseMs: number = RETRY_PAUSE_MS,
): Promise<string | null> {
  let why: string | null = null;
  for (let attempt = 1; attempt <= WRITE_TRIES; attempt++) {
    why = await once().catch(errorText);
    if (why === null) return null;
    if (why.startsWith('missing_binding')) return why;
    if (attempt < WRITE_TRIES) await pause(pauseMs * attempt);
  }
  return why;
}
