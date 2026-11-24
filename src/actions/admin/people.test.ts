import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { adminScope, deps, enrolledPerson, HOUR, T0, storedFor } from '../../../test/helpers/auth';
import { unique } from '../../../test/helpers/reference';
import { issueEnrolment } from '../../auth/enrol';
import { completeLogin, loginOptions } from '../../auth/login';
import { offboard } from '../../auth/offboard';
import { readSession } from '../../auth/session';
import { createPerson } from '../../db/person-create';
import { listFirms } from '../../db/firms';
import { listPeople, personDetail } from '../../db/people';
import { clientWithKeyCount } from '../../db/test-support';
import { currentEnv } from '../../lib/env';

async function liveState(personId: string) {
  const [credentials, codes, links, sessions] = await Promise.all([
    storedFor('credential', personId),
    storedFor('recovery_code', personId),
    storedFor('enrolment', personId),
    storedFor('session', personId),
  ]);
  return {
    credentials: credentials.filter((r) => r.revoked_at === null).length,
    codes: codes.filter((r) => r.used_at === null).length,
    links: links.filter((r) => r.used_at === null).length,
    sessions: sessions.filter((r) => r.revoked_at === null).length,
  };
}

describe('SEC-23 an offboarded person keeps no access', () => {
  it('SEC-23 offboarding revokes credentials, sessions, recovery codes and open links, and refuses login', async () => {
    const d = deps();
    const admin = await adminScope();
    const person = await enrolledPerson();
    await issueEnrolment(admin, d.db, d.secret, person.personId, T0 + HOUR);
    expect(await liveState(person.personId)).toEqual({
      credentials: 1,
      codes: 10,
      links: 1,
      sessions: 1,
    });

    await offboard(admin, d.db, person.personId, T0 + 2 * HOUR);

    expect(await liveState(person.personId)).toEqual({
      credentials: 0,
      codes: 0,
      links: 0,
      sessions: 0,
    });
    expect((await personDetail(d.db, person.personId))?.offboarded_at).toBe(T0 + 2 * HOUR);
    expect(await readSession(d.db, d.secret, person.sessionId, T0 + 3 * HOUR)).toBeNull();
    const { options, challengeId } = await loginOptions(d, T0 + 3 * HOUR);
    const response = await person.authenticator.assert(options, d.rp.origin);
    await expect(completeLogin(d, challengeId, response, T0 + 3 * HOUR)).rejects.toMatchObject({
      code: 'login_failed',
    });
  });

  it('SEC-23 offboarding one person leaves another person access untouched', async () => {
    const admin = await adminScope();
    const leaving = await enrolledPerson();
    const staying = await enrolledPerson();
    await offboard(admin, deps().db, leaving.personId, T0);
    expect(await liveState(staying.personId)).toEqual({
      credentials: 1,
      codes: 10,
      links: 0,
      sessions: 1,
    });
  });

  it('SEC-23 an offboarded person cannot be offboarded again, and is not found by a second try', async () => {
    const admin = await adminScope();
    const person = await enrolledPerson();
    await offboard(admin, deps().db, person.personId, T0);
    await expect(offboard(admin, deps().db, person.personId, T0)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(offboard(admin, deps().db, 'nobody', T0)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('people', () => {
  it('a person is created under an existing firm with no access until a link is issued', async () => {
    const admin = await adminScope();
    const [firm] = await listFirms(env.DB);
    const email = `${unique('new').replace(/\W/g, '')}@practice.example`;
    const { id } = await createPerson(
      admin,
      env.DB,
      currentEnv().NOTE_KEK,
      { name: 'New Person', email, externalCode: 'R-7', firm: { id: firm?.id ?? '' } },
      T0,
    );
    const row = await personDetail(env.DB, id);
    expect(row).toMatchObject({ email, external_code: 'R-7', firm_id: firm?.id, roles: '' });
    expect(await liveState(id)).toEqual({ credentials: 0, codes: 0, links: 0, sessions: 0 });
    await expect(
      createPerson(
        admin,
        env.DB,
        currentEnv().NOTE_KEK,
        {
          name: 'Dup',
          email: email.toUpperCase(),
          externalCode: null,
          firm: { id: firm?.id ?? '' },
        },
        T0,
      ),
    ).rejects.toMatchObject({ code: 'email_taken' });
    expect((await listPeople(env.DB)).some((p) => p.id === id)).toBe(true);
  });

  it('a new firm is booked as a client with its own key, and a taken firm name is refused', async () => {
    const admin = await adminScope();
    const name = unique('Fernhill Associates');
    const email = `${unique('p').replace(/\W/g, '')}@fernhill.example`;
    const made = await createPerson(
      admin,
      env.DB,
      currentEnv().NOTE_KEK,
      { name: 'Fern Person', email, externalCode: null, firm: { newName: name } },
      T0,
    );
    const firm = (await listFirms(env.DB)).find((f) => f.id === made.firmId);
    expect(firm?.name).toBe(name);
    const client = await clientWithKeyCount(env.DB, firm?.client_id ?? '');
    expect(client).toEqual({ name, keys: 1 });
    await expect(
      createPerson(
        admin,
        env.DB,
        currentEnv().NOTE_KEK,
        {
          name: 'Other',
          email: `${unique('q').replace(/\W/g, '')}@fernhill.example`,
          externalCode: null,
          firm: { newName: name.toUpperCase() },
        },
        T0,
      ),
    ).rejects.toMatchObject({ code: 'name_taken' });
  });
});
