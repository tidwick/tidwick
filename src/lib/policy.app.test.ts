// The app project sets knobs off their defaults in vitest.config.ts, so each app test that reads one proves a deploy
// variable reaches the Action or page that uses it. This test holds that setup itself: the running Worker parsed them.
import { describe, expect, it } from 'vitest';
import { ADMIN, addPerson, storedFor } from '../../test/helpers/auth';
import { caller, rpcForm } from '../../test/helpers/callers';
import { currentEnv } from './env';
import { DEFAULT_POLICY } from './policy';

describe('the knobs the app project sets', () => {
  it('reach the running Worker as parsed numbers, not as the defaults', () => {
    const { POLICY } = currentEnv();
    expect(POLICY).toMatchObject({
      agentTokenMax: 4,
      agentTokenDays: [7, 30, 180],
      agentTokenDefaultDays: 180,
      mcpAccessMs: 45 * 60_000,
      mcpRefreshIdleMs: 20 * 86_400_000,
      mcpGrantMs: 60 * 86_400_000,
      auditPage: 20,
      enrolmentMs: 48 * 3_600_000,
      pendingCodesMs: 5 * 60_000,
      notSubmittedWeeks: 3,
      backupKeepMs: 30 * 86_400_000,
    });
    expect(POLICY.agentTokenMax).not.toBe(DEFAULT_POLICY.agentTokenMax);
    expect(POLICY.sessionIdleMs).toBe(DEFAULT_POLICY.sessionIdleMs);
  });

  it('ENROLMENT_HOURS: the admin Actions that issue and re-issue a link give it the configured life', async () => {
    const admin = await caller([ADMIN]);
    for (const action of ['people.issueEnrolment', 'people.reenrol'] as const) {
      const person = await addPerson();
      const before = Date.now();
      expect((await rpcForm(action, admin, { id: person.id })).status).toBe(200);
      const rows = await storedFor('enrolment', person.id);
      const row = rows.at(-1);
      const life = (Number(row?.expires_at) || 0) - before;
      expect(life, action).toBeGreaterThan(48 * 3_600_000 - 60_000);
      expect(life).toBeLessThanOrEqual(48 * 3_600_000 + 60_000);
    }
  });
});
