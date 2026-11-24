import { createScheduledController } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { putSetting } from '../db/test-support-backup';
import { CHECK_CRON, scheduled } from './scheduled';

const NINE = Date.UTC(2026, 10, 18, 9);
const tick = () => createScheduledController({ cron: CHECK_CRON, scheduledTime: NINE });

/** A send-email binding that records every message it is handed. */
function spyBinding() {
  return { send: vi.fn(() => Promise.resolve()) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('with MAIL off, as the demo runs, nothing is ever sent', () => {
  beforeAll(async () => {
    await putSetting(env.DB, 'alert_to', 'ops@example.net');
  });

  it('a check with a problem and an alert address hands the send-email binding nothing, and logs why', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const binding = spyBinding();
    await scheduled(tick(), { ...env, EMAIL: binding, MAIL: 'off' });
    expect(binding.send).not.toHaveBeenCalled();
    const lines = log.mock.calls.map((call) => String(call[0]));
    expect(lines).toContain('tidwick: check found:');
    expect(lines).toContain('tidwick: check alert not sent: MAIL is off');
  });

  it('with no send-email binding at all the check still runs and logs its findings', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { DB } = env;
    await scheduled(tick(), { DB, MAIL: 'off' });
    expect(log.mock.calls.map((call) => String(call[0]))).toContain('tidwick: check found:');
  });

  it('the same check with MAIL on sends one message through the binding', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const binding = spyBinding();
    await scheduled(tick(), { ...env, EMAIL: binding });
    expect(binding.send).toHaveBeenCalledTimes(1);
  });
});
