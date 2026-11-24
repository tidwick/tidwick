import { describe, expect, it } from 'vitest';
import { adminScope, DAY, deps, enrolledPerson, MINUTE, T0 } from '../../test/helpers/auth';
import { appendEvent } from '../db/audit';
import { attemptOf, countFailure } from '../db/recovery-attempts';
import { storedRows } from '../db/stored-rows';
import { racingDb } from '../db/test-support';
import { emailHash, LOCK_AFTER, lockDuration, unlockRecovery } from './lockout';
import { completeLogin, loginOptions } from './login';
import { recover } from './recovery';

const WRONG = '0000-0000-0000-0000';

async function failTimes(email: string, times: number, at: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    await expect(recover(deps(), email, WRONG, at)).rejects.toMatchObject({
      code: 'recovery_failed',
    });
  }
}

describe('recovery lockout', () => {
  it('SEC-08 five failures lock recovery for that email, and even a right code is refused while locked', async () => {
    expect(LOCK_AFTER).toBe(5);
    const person = await enrolledPerson();
    await failTimes(person.email, 4, T0);
    await failTimes(person.email, 1, T0);
    await expect(
      recover(deps(), person.email, person.codes[0] ?? '', T0 + 1),
    ).rejects.toMatchObject({ code: 'recovery_failed' });
    await expect(
      recover(deps(), person.email, person.codes[0] ?? '', T0 + MINUTE),
    ).resolves.toBeTruthy();
    const locks = (await storedRows(deps().db, 'audit_event')).filter(
      (e) => e.action === 'auth.recoveryLocked',
    );
    expect(locks).toHaveLength(1);
    expect(locks[0]?.actor_id).toBeNull();
  });

  it('SEC-08 the lock backs off from 1 minute, doubling per failure, capped at 60 minutes', async () => {
    expect([4, 5, 6, 7, 8, 9, 10, 11, 30].map((n) => lockDuration(n) / MINUTE)).toEqual([
      0, 1, 2, 4, 8, 16, 32, 60, 60,
    ]);
    const person = await enrolledPerson();
    await failTimes(person.email, 5, T0);
    await failTimes(person.email, 1, T0 + MINUTE);
    const code = person.codes[0] ?? '';
    await expect(recover(deps(), person.email, code, T0 + 3 * MINUTE - 1)).rejects.toMatchObject({
      code: 'recovery_failed',
    });
    await expect(recover(deps(), person.email, code, T0 + 3 * MINUTE)).resolves.toBeTruthy();
  });

  it('SEC-08 an unknown email is counted and locked like a known one, with the same answer', async () => {
    const person = await enrolledPerson();
    const unknown = 'nobody@practice.example';
    const errors: unknown[] = [];
    for (const email of [person.email, unknown]) {
      await recover(deps(), email, WRONG, T0).catch((error: unknown) => errors.push(error));
    }
    expect(errors).toHaveLength(2);
    expect(String(errors[0])).toBe(String(errors[1]));
    await failTimes(unknown, 4, T0);
    const hashes = await Promise.all(
      [person.email, unknown].map((e) => emailHash(deps().secret, e)),
    );
    const attempts = (await storedRows(deps().db, 'recovery_attempt')).filter((a) =>
      hashes.includes(String(a.email_hash)),
    );
    expect(attempts.map((a) => a.failures).toSorted()).toEqual([1, 5]);
    expect(attempts.filter((a) => a.locked_until === T0 + MINUTE)).toHaveLength(1);
    expect(JSON.stringify(attempts)).not.toContain(unknown);
  });

  it('SEC-08 an admin reset clears the lock, audited, and a success clears the count', async () => {
    const person = await enrolledPerson();
    await failTimes(person.email, 5, T0);
    const scope = await adminScope();
    expect(await unlockRecovery(scope, deps().db, deps().secret, person.personId, T0)).toBe(true);
    expect(await unlockRecovery(scope, deps().db, deps().secret, person.personId, T0)).toBe(false);
    await expect(recover(deps(), person.email, person.codes[0] ?? '', T0)).resolves.toBeTruthy();
    const unlock = (await storedRows(deps().db, 'audit_event')).find(
      (e) => e.action === 'people.unlock',
    );
    expect(unlock?.actor_id).toBe(scope.actorId);
    await failTimes(person.email, 4, T0);
    await expect(recover(deps(), person.email, person.codes[1] ?? '', T0)).resolves.toBeTruthy();
    const hash = await emailHash(deps().secret, person.email);
    const left = await storedRows(deps().db, 'recovery_attempt');
    expect(left.filter((a) => a.email_hash === hash)).toHaveLength(0);
  });

  it('SEC-08 an admin reset survives another audited write moving the chain head before its batch', async () => {
    const person = await enrolledPerson();
    await failTimes(person.email, 5, T0);
    const scope = await adminScope();
    const bump = () =>
      appendEvent(scope, deps().db, {
        at: T0,
        action: 'test.bump',
        clientId: null,
        target: 'test',
      });
    const db = racingDb(deps().db, bump, 1);
    expect(await unlockRecovery(scope, db, deps().secret, person.personId, T0)).toBe(true);
    const hash = await emailHash(deps().secret, person.email);
    expect(await attemptOf(deps().db, hash)).toBeNull();
  });

  it("SEC-08 only a known person's first lock in a run is audited, and an unknown email's locks never are", async () => {
    const person = await enrolledPerson();
    const unknown = 'flood@practice.example';
    for (const email of [person.email, unknown]) {
      await failTimes(email, 5, T0);
      await failTimes(email, 1, T0 + MINUTE);
      await failTimes(email, 1, T0 + 3 * MINUTE);
    }
    const [known, stranger] = await Promise.all(
      [person.email, unknown].map((e) => emailHash(deps().secret, e)),
    );
    const locksOf = async (hash: string | undefined) =>
      (await storedRows(deps().db, 'audit_event')).filter(
        (e) => e.action === 'auth.recoveryLocked' && e.target === `recovery:${String(hash)}`,
      );
    expect(await locksOf(known)).toHaveLength(1);
    expect(await locksOf(stranger)).toEqual([]);
    const attempts = await storedRows(deps().db, 'recovery_attempt');
    const strangerRow = attempts.find((a) => a.email_hash === stranger);
    expect(strangerRow?.locked_until).toBe(T0 + 3 * MINUTE + 4 * MINUTE);
  });

  it('SEC-08 a fifth failure racing another answers recovery_failed for a known email as for an unknown one, and the email locks', async () => {
    const person = await enrolledPerson();
    for (const email of [person.email, 'racer@practice.example']) {
      await failTimes(email, 4, T0);
      const hash = await emailHash(deps().secret, email);
      const db = racingDb(deps().db, () => countFailure(deps().db, hash, T0), 1);
      await expect(recover({ ...deps(), db }, email, WRONG, T0)).rejects.toMatchObject({
        code: 'recovery_failed',
      });
      expect((await attemptOf(deps().db, hash))?.locked_until).toBe(T0 + MINUTE);
      const locks = (await storedRows(deps().db, 'audit_event')).filter(
        (e) => e.action === 'auth.recoveryLocked' && e.target === `recovery:${hash}`,
      );
      expect(locks).toHaveLength(email === person.email ? 1 : 0);
    }
  });

  it('SEC-08 a locked email never blocks that person signing in with a passkey', async () => {
    const person = await enrolledPerson();
    await failTimes(person.email, 5, T0);
    const d = deps();
    const { options, challengeId } = await loginOptions(d, T0);
    const assertion = await person.authenticator.assert(options, d.rp.origin);
    await expect(completeLogin(d, challengeId, assertion, T0)).resolves.toMatchObject({
      personId: person.personId,
    });
  });
  it('SEC-08 a failure prunes counters a day past their last failure, and keeps every one failed since', async () => {
    const later = T0 + 30 * DAY;
    const [stale, recent] = await Promise.all(
      ['stale@practice.example', 'recent@practice.example'].map((e) => emailHash(deps().secret, e)),
    );
    await failTimes('stale@practice.example', 2, later);
    await failTimes('recent@practice.example', 2, later + DAY);
    expect((await attemptOf(deps().db, stale ?? ''))?.failures).toBe(2);
    await failTimes('trigger@practice.example', 1, later + DAY + 1);
    expect(await attemptOf(deps().db, stale ?? '')).toBeNull();
    expect((await attemptOf(deps().db, recent ?? ''))?.failures).toBe(2);
  });
});
