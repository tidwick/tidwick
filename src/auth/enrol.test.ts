import { describe, expect, it } from 'vitest';
import { addPerson, adminScope, DAY, deps, offboard, storedFor, T0 } from '../../test/helpers/auth';
import { createSoftwareAuthenticator } from '../../test/helpers/software-authenticator';
import { appendEvent } from '../db/audit';
import { insertEnrolment } from '../db/enrolments';
import { storedRows } from '../db/stored-rows';
import { racingDb } from '../db/test-support';
import { completeEnrolment, ENROLMENT_MS, enrolOptions, issueEnrolment } from './enrol';
import { readSession } from './session';
import { keyedHash, randomToken } from './tokens';

async function issued(now = T0) {
  const d = deps();
  const person = await addPerson();
  const token = await issueEnrolment(await adminScope(), d.db, d.secret, person.id, now);
  return { d, person, token };
}

async function enrolWith(token: string, optionsAt: number, verifyAt = optionsAt) {
  const d = deps();
  const authenticator = await createSoftwareAuthenticator();
  const { options, challengeId } = await enrolOptions(d, token, optionsAt);
  const registration = await authenticator.register(options, d.rp.origin);
  return completeEnrolment(d, token, challengeId, registration, verifyAt);
}

/** A second open link for `personId`, as two admins issuing at the same moment would leave. */
async function extraLink(personId: string): Promise<string> {
  const d = deps();
  const token = randomToken();
  const tokenHash = await keyedHash(d.secret, 'enrol', token);
  await insertEnrolment(d.db, { tokenHash, personId, expiresAt: T0 + DAY }).run();
  return token;
}

describe('enrolment links', () => {
  it('SEC-03 an enrolment link is stored only as the keyed hash of its token', async () => {
    const { d, person, token } = await issued();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await storedFor('enrolment', person.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash).toBe(await keyedHash(d.secret, 'enrol', token));
    expect(rows[0]?.person_id).toBe(person.id);
    expect(JSON.stringify(await storedRows(d.db, 'enrolment'))).not.toContain(token);
    const events = await storedRows(d.db, 'audit_event');
    expect(JSON.stringify(events)).not.toContain(token);
    expect(events.map((e) => e.action)).toContain('people.issueEnrolment');
  });

  it('SEC-03 an enrolment link works once: options and verify with a used link are refused', async () => {
    const { token } = await issued();
    const done = await enrolWith(token, T0);
    expect(done.codes).toHaveLength(10);
    await expect(enrolOptions(deps(), token, T0 + 1)).rejects.toMatchObject({
      code: 'enrolment_invalid',
    });
    await expect(enrolWith(token, T0 + 2)).rejects.toMatchObject({ code: 'enrolment_invalid' });
  });

  it("SEC-03 issuing a new link closes the person's earlier one, and the new one still enrols", async () => {
    const { d, person, token: first } = await issued();
    const second = await issueEnrolment(await adminScope(), d.db, d.secret, person.id, T0 + 1);
    await expect(enrolOptions(d, first, T0 + 2)).rejects.toMatchObject({
      code: 'enrolment_invalid',
    });
    await expect(enrolWith(second, T0 + 2)).resolves.toBeTruthy();
    const closed = (await storedRows(d.db, 'audit_event')).filter(
      (e) => e.action === 'enrolment.revoke' && e.target === `person:${person.id}`,
    );
    expect(closed.map((e) => e.before_json)).toEqual(['{"open":1}']);
  });

  it('SEC-03 enrolling through one of two open links refuses the other, in either order', async () => {
    for (const order of ['issued first', 'issued second'] as const) {
      const { person, token } = await issued();
      const extra = await extraLink(person.id);
      const [used, stale] = order === 'issued first' ? [token, extra] : [extra, token];
      await enrolWith(used, T0 + 1);
      await expect(enrolOptions(deps(), stale, T0 + 2), order).rejects.toMatchObject({
        code: 'enrolment_invalid',
      });
      expect(await storedFor('credential', person.id), order).toHaveLength(1);
    }
  });

  it('SEC-03 two ceremonies racing on one link register only one passkey', async () => {
    const { d, person, token } = await issued();
    const first = await createSoftwareAuthenticator();
    const second = await createSoftwareAuthenticator();
    const a = await enrolOptions(d, token, T0);
    const b = await enrolOptions(d, token, T0);
    const ra = await first.register(a.options, d.rp.origin);
    const rb = await second.register(b.options, d.rp.origin);
    await completeEnrolment(d, token, a.challengeId, ra, T0);
    await expect(completeEnrolment(d, token, b.challengeId, rb, T0)).rejects.toMatchObject({
      code: 'enrolment_invalid',
    });
    expect(await storedFor('credential', person.id)).toHaveLength(1);
  });

  it('SEC-03 a valid link still enrols when another audited write moves the chain head before the batch', async () => {
    for (const moves of [1, 2]) {
      const { d, person, token } = await issued();
      const admin = await adminScope();
      const bump = () =>
        appendEvent(admin, d.db, { at: T0, action: 'test.bump', clientId: null, target: 'test' });
      const racing = { ...d, db: racingDb(d.db, bump, moves) };
      const authenticator = await createSoftwareAuthenticator();
      const { options, challengeId } = await enrolOptions(d, token, T0);
      const registration = await authenticator.register(options, d.rp.origin);
      const done = await completeEnrolment(racing, token, challengeId, registration, T0);
      expect(done.codes, `${String(moves)} moves`).toHaveLength(10);
      expect(await storedFor('credential', person.id)).toHaveLength(1);
      expect(
        (await storedRows(d.db, 'audit_event')).filter(
          (e) => e.action === 'auth.enrol' && e.target === `person:${person.id}`,
        ),
      ).toHaveLength(1);
    }
  });

  it('SEC-03 three head moves end in conflict and leave the link unused, so a fresh try enrols', async () => {
    const { d, person, token } = await issued();
    const admin = await adminScope();
    const bump = () =>
      appendEvent(admin, d.db, { at: T0, action: 'test.bump', clientId: null, target: 'test' });
    const racing = { ...d, db: racingDb(d.db, bump, 3) };
    const authenticator = await createSoftwareAuthenticator();
    const first = await enrolOptions(d, token, T0);
    const registration = await authenticator.register(first.options, d.rp.origin);
    await expect(
      completeEnrolment(racing, token, first.challengeId, registration, T0),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await storedFor('credential', person.id)).toHaveLength(0);
    const again = await enrolOptions(d, token, T0);
    const second = await authenticator.register(again.options, d.rp.origin);
    const done = await completeEnrolment(d, token, again.challengeId, second, T0);
    expect(done.codes).toHaveLength(10);
  });

  it('SEC-03 a link used by another ceremony after the head moved is still enrolment_invalid, with one passkey', async () => {
    const { d, person, token } = await issued();
    const winner = await createSoftwareAuthenticator();
    const loser = await createSoftwareAuthenticator();
    const a = await enrolOptions(d, token, T0);
    const b = await enrolOptions(d, token, T0);
    const ra = await winner.register(a.options, d.rp.origin);
    const rb = await loser.register(b.options, d.rp.origin);
    const racing = {
      ...d,
      db: racingDb(d.db, () => completeEnrolment(d, token, a.challengeId, ra, T0), 1),
    };
    await expect(completeEnrolment(racing, token, b.challengeId, rb, T0)).rejects.toMatchObject({
      code: 'enrolment_invalid',
    });
    expect(await storedFor('credential', person.id)).toHaveLength(1);
  });

  it('SEC-03 an enrolment link expires 24 hours after it is issued', async () => {
    expect(ENROLMENT_MS).toBe(DAY);
    const late = await issued();
    await expect(enrolOptions(deps(), late.token, T0 + DAY)).rejects.toMatchObject({
      code: 'enrolment_invalid',
    });
    const slow = await issued();
    await expect(enrolWith(slow.token, T0 + DAY - 60_000, T0 + DAY)).rejects.toMatchObject({
      code: 'enrolment_invalid',
    });
    const inTime = await issued();
    await expect(enrolWith(inTime.token, T0 + DAY - 1)).resolves.toBeTruthy();
  });

  it('SEC-03 a link enrols only its own person: an unknown token, another link and an offboarded person are refused', async () => {
    const d = deps();
    await expect(enrolOptions(d, 'not-a-token', T0)).rejects.toMatchObject({
      code: 'enrolment_invalid',
    });
    const one = await issued();
    const two = await issued();
    const authenticator = await createSoftwareAuthenticator();
    const forOne = await enrolOptions(d, one.token, T0);
    const registration = await authenticator.register(forOne.options, d.rp.origin);
    await expect(
      completeEnrolment(d, two.token, forOne.challengeId, registration, T0),
    ).rejects.toMatchObject({ code: 'passkey_failed' });
    await offboard(two.person.id);
    await expect(enrolOptions(d, two.token, T0)).rejects.toMatchObject({
      code: 'enrolment_invalid',
    });
  });

  it('enrolment registers the passkey, opens a session, stores ten hashed codes and is audited', async () => {
    const { d, person, token } = await issued();
    const done = await enrolWith(token, T0);
    expect((await readSession(d.db, d.secret, done.sessionId, T0))?.personId).toBe(person.id);
    const codes = await storedFor('recovery_code', person.id);
    expect(codes).toHaveLength(10);
    for (const code of done.codes) expect(JSON.stringify(codes)).not.toContain(code);
    const events = await storedRows(d.db, 'audit_event');
    const enrol = events.find(
      (e) => e.action === 'auth.enrol' && e.target === `person:${person.id}`,
    );
    expect(enrol?.actor_id).toBe(person.id);
    expect(enrol?.target).toBe(`person:${person.id}`);
  });
});
