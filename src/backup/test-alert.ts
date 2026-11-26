// The admin's "Send test alert": one email to `alert_to` through the same mailer the 09:00 check uses, so a
// misrouted address or a missing Email Routing destination shows now and not on the night a backup fails.
import { appendEvent } from '../db/audit';
import type { Scope } from '../db/scope';
import { lastTestEvent } from '../db/alert-test';
import { alertTo } from '../db/settings';
import { errorText } from '../lib/error-text';
import { fail } from '../lib/errors';
import type { Mailer } from '../lib/mail';

export const TEST_SUBJECT = 'tidwick: test alert';

/** The audit target of every test, and what the status block looks the latest one up by. */
export const TEST_TARGET = 'alert:test';

/** Least gap between two sends; the action is admin-only without step-up, so it must not become a mail flood. */
export const TEST_COOLDOWN_MS = 60_000;

export interface TestAlert {
  sent: boolean;
  /** Why it did not go, in words an admin can act on; null when it did. */
  error: string | null;
}

async function deliver(db: D1Database, mailer: Mailer | null, now: number): Promise<TestAlert> {
  const to = await alertTo(db);
  if (to === null) return { sent: false, error: 'No alert address is saved, so nothing was sent.' };
  if (mailer === null) {
    return { sent: false, error: 'Email is off on this deployment (MAIL), so nothing was sent.' };
  }
  try {
    await mailer.send({
      to,
      subject: TEST_SUBJECT,
      text: `This is a test of the tidwick alert path, sent at ${new Date(now).toISOString()}. If you can read it, backup alerts will reach you.`,
    });
    return { sent: true, error: null };
  } catch (error) {
    return { sent: false, error: `The mail binding refused it: ${errorText(error)}` };
  }
}

/**
 * Sends the test and records it, success or not, as one audit event that carries the delivery error, so the
 * result outlives the page. Only an `all` scope may send it.
 */
export async function sendTestAlert(
  scope: Scope,
  db: D1Database,
  mailer: Mailer | null,
  now: number,
): Promise<TestAlert> {
  if (scope.kind !== 'all') fail('forbidden');
  const last = await lastTestEvent(db, TEST_TARGET);
  if (last !== null && now - last.at < TEST_COOLDOWN_MS) fail('rate_limited');
  const result = await deliver(db, mailer, now);
  await appendEvent(scope, db, {
    at: now,
    action: 'alerts.test',
    clientId: null,
    target: TEST_TARGET,
    after: result,
  });
  return result;
}

/** The newest test and when it ran, or null when none has. */
export async function lastTestAlert(db: D1Database): Promise<(TestAlert & { at: number }) | null> {
  const row = await lastTestEvent(db, TEST_TARGET);
  if (row === null) return null;
  return { at: row.at, ...(JSON.parse(row.after_json) as TestAlert) };
}
