// The Workers rate-limit binding counts in fixed windows aligned to the wall clock (ADR 0003). A test that
// spends a whole window's allowance must run inside one window, or the count resets mid-test.
const PERIOD_MS = 60_000;

const epoch = (): number => Math.floor(Date.now() / PERIOD_MS);

/**
 * Runs `scenario` until one attempt starts and ends in the same window. Each attempt gets a fresh `attempt`
 * number so the caller can key it to its own address. An attempt that straddled a boundary is discarded
 * (its assertions may have failed only because the count reset), the next one waits for a fresh window.
 */
export async function withinOneWindow(
  scenario: (attempt: number) => Promise<void>,
  attempts = 3,
): Promise<void> {
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const start = epoch();
    try {
      await scenario(attempt);
      if (epoch() === start) return;
    } catch (error) {
      if (epoch() === start) throw error;
      last = error;
    }
    const wait = (start + 1) * PERIOD_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait + 50));
  }
  throw new Error('the scenario kept straddling a rate-limit window boundary', { cause: last });
}
