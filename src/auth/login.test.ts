import { describe, expect, it } from 'vitest';
import { deps, enrolledPerson, MINUTE, offboard, T0, type Enrolled } from '../../test/helpers/auth';
import { adminScope } from '../../test/helpers/auth';
import { completeLogin, loginOptions } from './login';
import { revokeAccess } from './revoke';
import { readSession } from './session';
import { DEFAULT_POLICY } from '../lib/policy';

async function assertion(person: Enrolled, now = T0, tweaks = {}) {
  const d = deps();
  const { options, challengeId } = await loginOptions(d, now);
  const response = await person.authenticator.assert(options, d.rp.origin, tweaks);
  return { challengeId, response };
}

describe('passkey login', () => {
  it('SEC-04 a passkey login with the software authenticator opens a session for that person', async () => {
    const person = await enrolledPerson();
    const { challengeId, response } = await assertion(person, T0 + MINUTE);
    const login = await completeLogin(deps(), challengeId, response, T0 + MINUTE);
    expect(login.personId).toBe(person.personId);
    expect(login.sessionId).not.toBe(person.sessionId);
    const session = await readSession(
      deps().db,
      deps().secret,
      login.sessionId,
      T0 + MINUTE,
      DEFAULT_POLICY.sessionIdleMs,
    );
    expect(session).toMatchObject({ personId: person.personId, mustEnrol: false });
  });

  it('SEC-04 a replayed challenge is rejected, with the same assertion or a fresh one', async () => {
    const person = await enrolledPerson();
    const d = deps();
    const { options, challengeId } = await loginOptions(d, T0);
    const first = await person.authenticator.assert(options, d.rp.origin);
    await completeLogin(d, challengeId, first, T0);
    await expect(completeLogin(d, challengeId, first, T0)).rejects.toMatchObject({
      code: 'login_failed',
    });
    const again = await person.authenticator.assert(options, d.rp.origin);
    await expect(completeLogin(d, challengeId, again, T0)).rejects.toMatchObject({
      code: 'login_failed',
    });
    const fresh = await loginOptions(d, T0);
    await expect(completeLogin(d, fresh.challengeId, first, T0)).rejects.toMatchObject({
      code: 'login_failed',
    });
  });

  it('SEC-04 a challenge expires after five minutes and is bound to the login purpose', async () => {
    const person = await enrolledPerson();
    const stale = await assertion(person, T0);
    await expect(
      completeLogin(deps(), stale.challengeId, stale.response, T0 + 5 * MINUTE),
    ).rejects.toMatchObject({ code: 'login_failed' });
    const missing = await assertion(person, T0);
    await expect(completeLogin(deps(), null, missing.response, T0)).rejects.toMatchObject({
      code: 'login_failed',
    });
  });

  it('SEC-04 no user verification, a revoked credential or an offboarded person cannot log in', async () => {
    const unverified = await enrolledPerson();
    const uv = await assertion(unverified, T0, { userVerified: false });
    await expect(completeLogin(deps(), uv.challengeId, uv.response, T0)).rejects.toMatchObject({
      code: 'login_failed',
    });
    const revoked = await enrolledPerson();
    await revokeAccess(await adminScope(), deps().db, revoked.personId, T0);
    const rv = await assertion(revoked, T0 + 1);
    await expect(completeLogin(deps(), rv.challengeId, rv.response, T0 + 1)).rejects.toMatchObject({
      code: 'login_failed',
    });
    const leaver = await enrolledPerson();
    await offboard(leaver.personId);
    const off = await assertion(leaver, T0);
    await expect(completeLogin(deps(), off.challengeId, off.response, T0)).rejects.toMatchObject({
      code: 'login_failed',
    });
  });
});
