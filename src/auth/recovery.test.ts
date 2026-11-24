import { describe, expect, it } from 'vitest';
import {
  adminScope,
  deps,
  enrolledPerson,
  MINUTE,
  offboard,
  storedFor,
  T0,
} from '../../test/helpers/auth';
import { createSoftwareAuthenticator } from '../../test/helpers/software-authenticator';
import { appendEvent } from '../db/audit';
import { activeCredentialsOf } from '../db/credentials';
import { liveSessionCount } from '../db/sessions';
import { storedRows } from '../db/stored-rows';
import { racingDb } from '../db/test-support';
import { addPasskeyOptions, completeAddPasskey } from './add-passkey';
import { completeEnrolment, enrolOptions } from './enrol';
import { completeLogin, loginOptions } from './login';
import { recover } from './recovery';
import { codeHash, newRecoveryCode, normalizeCode, regenerateCodes } from './recovery-codes';
import { reenrol } from './revoke';
import { readSession } from './session';

const actions = async () => (await storedRows(deps().db, 'audit_event')).map((e) => e.action);

describe('recovery codes and re-enrolment', () => {
  it('SEC-05 codes are ten per person, 80 random bits in Crockford base32, stored only as hashes', async () => {
    const person = await enrolledPerson();
    const d = deps();
    expect(new Set(person.codes).size).toBe(10);
    for (const code of person.codes)
      expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){3}[0-9A-HJKMNP-TV-Z]{4}$/);
    const stored = (await storedRows(d.db, 'recovery_code')).map((r) => r.code_hash);
    const expected = await Promise.all(
      person.codes.map((c) => codeHash(d.secret, normalizeCode(c) ?? '')),
    );
    expect(stored.toSorted()).toEqual(expected.toSorted());
    expect(normalizeCode(newRecoveryCode().toLowerCase().replace(/-/g, ' '))).toMatch(
      /^[0-9A-Z]{16}$/,
    );
    expect(normalizeCode('too-short')).toBeNull();
  });

  it('SEC-05 a recovery code still works when another audited write moves the chain head before the batch, once', async () => {
    const person = await enrolledPerson();
    const d = deps();
    const admin = await adminScope();
    const bump = () =>
      appendEvent(admin, d.db, { at: T0, action: 'test.bump', clientId: null, target: 'test' });
    const racing = { ...d, db: racingDb(d.db, bump, 2) };
    const code = person.codes[0] ?? '';
    await expect(recover(racing, person.email, code, T0)).resolves.toMatchObject({
      personId: person.personId,
    });
    await expect(recover(d, person.email, code, T0 + 1)).rejects.toMatchObject({
      code: 'recovery_failed',
    });
  });

  it('SEC-05 three head moves end in conflict and leave the code unused', async () => {
    const person = await enrolledPerson();
    const d = deps();
    const admin = await adminScope();
    const bump = () =>
      appendEvent(admin, d.db, { at: T0, action: 'test.bump', clientId: null, target: 'test' });
    const racing = { ...d, db: racingDb(d.db, bump, 3) };
    const code = person.codes[0] ?? '';
    await expect(recover(racing, person.email, code, T0)).rejects.toMatchObject({
      code: 'conflict',
    });
    await expect(recover(d, person.email, code, T0 + 1)).resolves.toMatchObject({
      personId: person.personId,
    });
  });

  it('SEC-05 a recovery code opens a must_enrol session that a new passkey replaces with a full one, audited', async () => {
    const person = await enrolledPerson();
    const d = deps();
    const code = person.codes[3] ?? '';
    const { sessionId } = await recover(d, person.email.toUpperCase(), code.toLowerCase(), T0);
    const session = await readSession(d.db, d.secret, sessionId, T0);
    expect(session).toMatchObject({ personId: person.personId, mustEnrol: true });
    expect(await actions()).toContain('auth.recover');
    if (!session) return;
    const fresh = await createSoftwareAuthenticator();
    const { options, challengeId } = await addPasskeyOptions(d, session, T0);
    const registration = await fresh.register(options, d.rp.origin);
    const added = await completeAddPasskey(d, session, challengeId, registration, T0);
    expect(await readSession(d.db, d.secret, sessionId, T0)).toBeNull();
    expect(added.sessionId).not.toBeNull();
    const full = await readSession(d.db, d.secret, added.sessionId ?? '', T0);
    expect(full).toMatchObject({ personId: person.personId, mustEnrol: false });
    expect(await actions()).toContain('auth.addPasskey');
  });

  it('SEC-05 a code is consumed once and its reuse is refused', async () => {
    const person = await enrolledPerson();
    const d = deps();
    const code = person.codes[0] ?? '';
    await recover(d, person.email, code, T0);
    await expect(recover(d, person.email, code, T0 + 1)).rejects.toMatchObject({
      code: 'recovery_failed',
    });
    const other = await enrolledPerson();
    await expect(recover(d, other.email, person.codes[1] ?? '', T0)).rejects.toMatchObject({
      code: 'recovery_failed',
    });
    await offboard(other.personId);
    await expect(recover(d, other.email, other.codes[0] ?? '', T0)).rejects.toMatchObject({
      code: 'recovery_failed',
    });
  });

  it('SEC-05 two recoveries racing on one code open exactly one session', async () => {
    const person = await enrolledPerson();
    const code = person.codes[5] ?? '';
    const results = await Promise.allSettled([
      recover(deps(), person.email, code, T0),
      recover(deps(), person.email, code, T0),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const used = (await storedFor('recovery_code', person.personId)).filter(
      (r) => r.used_at !== null,
    );
    expect(used).toHaveLength(1);
  });

  it('SEC-05 regenerating codes retires every unused one, audited', async () => {
    const person = await enrolledPerson();
    const d = deps();
    const next = await regenerateCodes(await adminScope(), d.db, d.secret, person.personId, T0);
    expect(next).toHaveLength(10);
    await expect(recover(d, person.email, person.codes[0] ?? '', T0)).rejects.toMatchObject({
      code: 'recovery_failed',
    });
    await expect(recover(d, person.email, next[0] ?? '', T0)).resolves.toBeTruthy();
    expect(await actions()).toContain('auth.regenerateCodes');
  });

  it('SEC-05 re-enrolment revokes every credential, session, code and link, with an audit event for each', async () => {
    const person = await enrolledPerson();
    const d = deps();
    const { options, challengeId } = await loginOptions(d, T0 + MINUTE);
    const assertion = await person.authenticator.assert(options, d.rp.origin);
    const second = await completeLogin(d, challengeId, assertion, T0 + MINUTE);
    const scope = await adminScope();
    const token = await reenrol(scope, d.db, d.secret, person.personId, T0 + 2 * MINUTE);
    const now = T0 + 3 * MINUTE;
    for (const id of [person.sessionId, second.sessionId]) {
      expect(await readSession(d.db, d.secret, id, now)).toBeNull();
    }
    const login = await loginOptions(d, now);
    const replay = await person.authenticator.assert(login.options, d.rp.origin);
    await expect(completeLogin(d, login.challengeId, replay, now)).rejects.toMatchObject({
      code: 'login_failed',
    });
    await expect(recover(d, person.email, person.codes[0] ?? '', now)).rejects.toMatchObject({
      code: 'recovery_failed',
    });
    const events = (await storedRows(d.db, 'audit_event')).filter(
      (e) => e.target === `person:${person.personId}` && e.actor_id === scope.actorId,
    );
    expect(events.map((e) => e.action)).toEqual([
      'credential.revoke',
      'session.revoke',
      'recovery_code.revoke',
      'enrolment.revoke',
      'people.reenrol',
    ]);
    const revoked = events.find((e) => e.action === 'session.revoke');
    expect(JSON.parse(String(revoked?.before_json))).toEqual({ sessions: 2 });
    const fresh = await createSoftwareAuthenticator();
    const again = await enrolOptions(d, token, now);
    const registration = await fresh.register(again.options, d.rp.origin);
    await expect(
      completeEnrolment(d, token, again.challengeId, registration, now),
    ).resolves.toBeTruthy();
  });

  it('SEC-05 a passkey is not added through a session revoked while its ceremony was in flight', async () => {
    const person = await enrolledPerson();
    const d = deps();
    const { sessionId } = await recover(d, person.email, person.codes[5] ?? '', T0);
    const session = await readSession(d.db, d.secret, sessionId, T0);
    expect(session).toMatchObject({ mustEnrol: true });
    if (!session) return;
    const fresh = await createSoftwareAuthenticator();
    const { options, challengeId } = await addPasskeyOptions(d, session, T0);
    const registration = await fresh.register(options, d.rp.origin);
    await reenrol(await adminScope(), d.db, d.secret, person.personId, T0);
    await expect(
      completeAddPasskey(d, session, challengeId, registration, T0),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await activeCredentialsOf(d.db, person.personId)).toEqual([]);
    expect(await liveSessionCount(d.db, person.personId, T0)).toBe(0);
  });
});
