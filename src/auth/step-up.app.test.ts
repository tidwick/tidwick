// Runs in the `app` project, so protected Actions are called through the real middleware.
import { describe, expect, it } from 'vitest';
import { ACCOUNTING, deps, enrolledPerson, MINUTE, type Enrolled } from '../../test/helpers/auth';
import { addRow, booking, cell, save, WEEK } from '../../test/helpers/booking';
import { caller, getPage, rpc } from '../../test/helpers/callers';
import { GRANTS } from '../db/roles';
import { newSession, readSession, type Session } from './session';
import { completeStepUp, requireStepUp, stepUpOptions } from './step-up';
import { DEFAULT_POLICY } from '../lib/policy';

/** A live session for an enrolled person whose last assertion was `ago` milliseconds before now. */
async function sessionOf(person: Enrolled, ago: number): Promise<Session> {
  const d = deps();
  const opened = await newSession(
    d.db,
    d.secret,
    person.personId,
    Date.now() - ago,
    DEFAULT_POLICY.sessionMaxMs,
  );
  await opened.statement.run();
  const session = await readSession(
    d.db,
    d.secret,
    opened.rawId,
    Date.now(),
    DEFAULT_POLICY.sessionIdleMs,
  );
  expect(session).not.toBeNull();
  return session ?? ({} as Session);
}

async function stepUpBy(session: Session, signer: Enrolled, now: number) {
  const d = deps();
  const { options, challengeId } = await stepUpOptions(d, session, now);
  const response = await signer.authenticator.assert(options, d.rp.origin);
  return { challengeId, response };
}

describe('SEC-10 step-up within 15 minutes before high-impact work', () => {
  it('SEC-10 the gate refuses an assertion 15 minutes old and accepts one just inside', () => {
    const session = { stepUpAt: 0 } as Session;
    expect(() => {
      requireStepUp(session, DEFAULT_POLICY.stepUpMs - 1, DEFAULT_POLICY.stepUpMs);
    }).not.toThrow();
    expect(() => {
      requireStepUp(session, DEFAULT_POLICY.stepUpMs, DEFAULT_POLICY.stepUpMs);
    }).toThrow(expect.objectContaining({ code: 'step_up_required' }) as Error);
  });

  it('SEC-10 a protected Action is rejected when the last assertion is older than 15 minutes', async () => {
    const stale = await caller([], { stepUpAgo: 16 * MINUTE });
    const response = await rpc('auth.addPasskeyOptions', stale);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'step_up_required' });
    const staleAdmin = await caller(GRANTS, { stepUpAgo: 16 * MINUTE });
    expect(await (await rpc('people.setRoles', staleAdmin)).json()).toMatchObject({
      error: 'step_up_required',
    });
    expect((await rpc('auth.stepUpOptions', stale)).status).toBe(200);
  });

  it('SEC-10 a protected Action is accepted with a fresh assertion', async () => {
    const fresh = await caller([], { stepUpAgo: 14 * MINUTE });
    const response = await rpc('auth.addPasskeyOptions', fresh);
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toMatch(/^__Host-tidwick-challenge=/);
  });

  it("SEC-10 a step-up with the session's own passkey stamps the session once", async () => {
    const person = await enrolledPerson();
    const session = await sessionOf(person, 20 * MINUTE);
    const now = Date.now();
    const { challengeId, response } = await stepUpBy(session, person, now);
    await completeStepUp(deps(), session, challengeId, response, now);
    const after = await readSession(
      deps().db,
      deps().secret,
      session.rawId,
      now,
      DEFAULT_POLICY.sessionIdleMs,
    );
    expect(after?.stepUpAt).toBe(now);
    expect(() => {
      requireStepUp(after ?? session, now, DEFAULT_POLICY.stepUpMs);
    }).not.toThrow();
    await expect(completeStepUp(deps(), session, challengeId, response, now)).rejects.toMatchObject(
      { code: 'passkey_failed' },
    );
  });

  it("SEC-10 another person's passkey or challenge does not step a session up", async () => {
    const person = await enrolledPerson();
    const other = await enrolledPerson();
    const session = await sessionOf(person, 20 * MINUTE);
    const otherSession = await sessionOf(other, 0);
    const now = Date.now();
    const foreignKey = await stepUpBy(session, other, now);
    await expect(
      completeStepUp(deps(), session, foreignKey.challengeId, foreignKey.response, now),
    ).rejects.toMatchObject({ code: 'passkey_failed' });
    const foreignChallenge = await stepUpBy(otherSession, person, now);
    await expect(
      completeStepUp(deps(), session, foreignChallenge.challengeId, foreignChallenge.response, now),
    ).rejects.toMatchObject({ code: 'passkey_failed' });
    const after = await readSession(
      deps().db,
      deps().secret,
      session.rawId,
      now,
      DEFAULT_POLICY.sessionIdleMs,
    );
    expect(after?.stepUpAt).toBe(session.stepUpAt);
    expect(() => {
      requireStepUp(session, now, DEFAULT_POLICY.stepUpMs);
    }).toThrow();
  });
  it("SEC-10 another person's week, notes and all, opens only with a fresh step-up", async () => {
    const b = await booking();
    const [task] = b.tasks;
    if (!task) return expect.unreachable('the booking has tasks');
    const rowId = await addRow(b.who, WEEK, b.projectId, task);
    const note = `step-up probe ${crypto.randomUUID()}`;
    expect((await save(b.who, WEEK, cell(rowId, 0, '2', note))).status).toBe(200);
    const path = `/approvals/${b.who.personId}/${WEEK}`;
    const stale = await getPage(path, await caller([ACCOUNTING], { stepUpAgo: 16 * MINUTE }));
    expect(stale.status).toBe(403);
    const refused = await stale.text();
    expect(refused).toContain('Confirm with your passkey');
    expect(refused).not.toContain(note);
    const fresh = await getPage(path, await caller([ACCOUNTING], { stepUpAgo: 14 * MINUTE }));
    expect(fresh.status).toBe(200);
    expect(await fresh.text()).toContain(note);
  });
});
