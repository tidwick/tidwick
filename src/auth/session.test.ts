import { describe, expect, it } from 'vitest';
import {
  adminScope,
  DAY,
  deps,
  enrolledPerson,
  HOUR,
  MINUTE,
  offboard,
  storedFor,
  T0,
} from '../../test/helpers/auth';
import { storedRows } from '../db/stored-rows';
import { CHALLENGE_COOKIE, challengeCookie } from './challenge';
import { revokeAccess } from './revoke';
import {
  clearedSessionCookie,
  cookieValue,
  endSession,
  newSession,
  readSession,
  SESSION_COOKIE,
  sessionCookie,
} from './session';
import { keyedHash } from './tokens';
import { DEFAULT_POLICY } from '../lib/policy';

describe('sessions', () => {
  it('SEC-06 the session cookie is __Host-, Secure, HttpOnly, SameSite=Strict on Path=/ for 14 days', () => {
    expect(sessionCookie('abc', DEFAULT_POLICY.sessionMaxMs)).toBe(
      '__Host-tidwick-session=abc; Path=/; Max-Age=1209600; HttpOnly; Secure; SameSite=Strict',
    );
    expect(clearedSessionCookie()).toBe(
      '__Host-tidwick-session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict',
    );
    expect(challengeCookie('xyz')).toBe(
      '__Host-tidwick-challenge=xyz; Path=/; Max-Age=300; HttpOnly; Secure; SameSite=Strict',
    );
    expect(sessionCookie('abc', DEFAULT_POLICY.sessionMaxMs)).not.toMatch(/Domain=/i);
    const header = `a=1; ${SESSION_COOKIE}=abc; ${CHALLENGE_COOKIE}=xyz`;
    expect(cookieValue(header, SESSION_COOKIE)).toBe('abc');
    expect(cookieValue(header, 'missing')).toBeNull();
  });

  it('SEC-06 the stored key is the keyed hash of the 256-bit cookie value, never the value itself', async () => {
    const person = await enrolledPerson();
    const d = deps();
    expect(person.sessionId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await storedFor('session', person.personId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id_hash).toBe(await keyedHash(d.secret, 'session', person.sessionId));
    expect(JSON.stringify(await storedRows(d.db, 'session'))).not.toContain(person.sessionId);
    const other = await newSession(
      d.db,
      d.secret,
      person.personId,
      T0,
      DEFAULT_POLICY.sessionMaxMs,
    );
    expect(other.rawId).not.toBe(person.sessionId);
  });

  it('SEC-06 a session ends after 8 hours idle, and activity keeps it alive', async () => {
    expect(DEFAULT_POLICY.sessionIdleMs).toBe(8 * HOUR);
    const person = await enrolledPerson();
    const d = deps();
    const read = (at: number) =>
      readSession(d.db, d.secret, person.sessionId, at, DEFAULT_POLICY.sessionIdleMs);
    expect(await read(T0 + 7 * HOUR)).not.toBeNull();
    expect(await read(T0 + 15 * HOUR - 1)).not.toBeNull();
    expect(await read(T0 + 15 * HOUR - 1 + 8 * HOUR)).toBeNull();
    const idle = await enrolledPerson();
    expect(
      await readSession(
        d.db,
        d.secret,
        idle.sessionId,
        T0 + 8 * HOUR,
        DEFAULT_POLICY.sessionIdleMs,
      ),
    ).toBeNull();
  });

  it('SEC-06 seen_at is written at most once a minute', async () => {
    const person = await enrolledPerson();
    const d = deps();
    await readSession(d.db, d.secret, person.sessionId, T0 + 30_000, DEFAULT_POLICY.sessionIdleMs);
    expect((await storedFor('session', person.personId))[0]?.seen_at).toBe(T0);
    await readSession(d.db, d.secret, person.sessionId, T0 + MINUTE, DEFAULT_POLICY.sessionIdleMs);
    expect((await storedFor('session', person.personId))[0]?.seen_at).toBe(T0 + MINUTE);
  });

  it('SEC-06 a session ends 14 days after it opened, however active', async () => {
    expect(DEFAULT_POLICY.sessionMaxMs).toBe(14 * DAY);
    const person = await enrolledPerson();
    const d = deps();
    let at = T0;
    while (at + 7 * HOUR < T0 + 14 * DAY) {
      at += 7 * HOUR;
      expect(
        await readSession(d.db, d.secret, person.sessionId, at, DEFAULT_POLICY.sessionIdleMs),
      ).not.toBeNull();
    }
    expect(
      await readSession(
        d.db,
        d.secret,
        person.sessionId,
        T0 + 14 * DAY,
        DEFAULT_POLICY.sessionIdleMs,
      ),
    ).toBeNull();
  });

  it('SEC-06 logout, offboarding and an unknown id leave no live session', async () => {
    const d = deps();
    const leaving = await enrolledPerson();
    await endSession(d.db, d.secret, leaving.sessionId, T0);
    expect(
      await readSession(d.db, d.secret, leaving.sessionId, T0, DEFAULT_POLICY.sessionIdleMs),
    ).toBeNull();
    const offboarded = await enrolledPerson();
    const second = await newSession(
      d.db,
      d.secret,
      offboarded.personId,
      T0,
      DEFAULT_POLICY.sessionMaxMs,
    );
    await second.statement.run();
    await revokeAccess(await adminScope(), d.db, offboarded.personId, T0);
    expect(
      await readSession(d.db, d.secret, offboarded.sessionId, T0, DEFAULT_POLICY.sessionIdleMs),
    ).toBeNull();
    expect(
      await readSession(d.db, d.secret, second.rawId, T0, DEFAULT_POLICY.sessionIdleMs),
    ).toBeNull();
    const flagged = await enrolledPerson();
    await offboard(flagged.personId);
    expect(
      await readSession(d.db, d.secret, flagged.sessionId, T0, DEFAULT_POLICY.sessionIdleMs),
    ).toBeNull();
    expect(
      await readSession(d.db, d.secret, 'forged', T0, DEFAULT_POLICY.sessionIdleMs),
    ).toBeNull();
  });
});
