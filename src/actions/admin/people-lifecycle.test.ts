// Editing a person, reinstating an offboarded one, and a firm's name following its client.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import {
  adminScope,
  deps,
  enrolledPerson,
  T0,
  addPerson,
  storedFor,
} from '../../../test/helpers/auth';
import { eventsAfter, headSeq, unique } from '../../../test/helpers/reference';
import { issueEnrolment } from '../../auth/enrol';
import { offboard } from '../../auth/offboard';
import { reinstate } from '../../auth/reinstate';
import { scopeFor } from '../../db/scope';
import { renameClient } from '../../db/clients';
import { listFirms } from '../../db/firms';
import { personDetail } from '../../db/people';
import { createPerson } from '../../db/person-create';
import { currentEnv } from '../../lib/env';
import { updatePerson } from '../../db/person-update';

const allow: (emailChanges: boolean) => void = () => undefined;
const HOME = 'f-home';
let cached: Awaited<ReturnType<typeof adminScope>> | undefined;
/** One admin for the file, so an event's actor can be compared. */
async function theAdmin() {
  cached ??= await adminScope();
  return cached;
}

async function edit(
  id: string,
  changes: Partial<Parameters<typeof updatePerson>[3]>,
  gate = allow,
) {
  const admin = await theAdmin();
  const was = (await personDetail(admin, env.DB, id)) ?? expect.unreachable('no person');
  const next = {
    name: was.name,
    email: was.email,
    externalCode: was.external_code,
    firmId: was.firm_id,
    ...changes,
  };
  await updatePerson(admin, env.DB, id, next, T0, gate);
}

describe('people.update', () => {
  it('changes name, code and firm in one event holding the old and new values', async () => {
    const person = await addPerson([]);
    const admin = await theAdmin();
    const made = await createPerson(
      admin,
      env.DB,
      currentEnv().NOTE_KEK,
      {
        name: 'Elsewhere',
        email: `${unique('e')}@other.example`.toLowerCase(),
        externalCode: null,
        firm: { newName: unique('Other Firm') },
      },
      T0,
    );
    const firmId = made.firmId;
    const seq = await headSeq();
    await edit(person.id, { name: 'Renamed Person', externalCode: 'K9', firmId });
    const events = (await eventsAfter(seq)).filter((e) => e.action === 'people.update');
    expect(events).toHaveLength(1);
    expect(events[0]?.target).toBe(`person:${person.id}`);
    expect(events[0]?.actor_id).toBe(admin.actorId);
    expect(JSON.parse(events[0]?.before_json ?? '{}')).toMatchObject({ external_code: null });
    expect(JSON.parse(events[0]?.after_json ?? '{}')).toMatchObject({
      name: 'Renamed Person',
      external_code: 'K9',
      firm_id: firmId,
    });
    const now = await personDetail(await theAdmin(), env.DB, person.id);
    expect(now).toMatchObject({ name: 'Renamed Person', external_code: 'K9', firm_id: firmId });
  });

  it('asks its gate whether the email changes, and writes nothing when the gate refuses', async () => {
    const person = await addPerson([]);
    const seen: boolean[] = [];
    await edit(person.id, { name: 'Same Email' }, (changes) => void seen.push(changes));
    const mail = `moved-${unique('m')}@practice.example`.toLowerCase();
    const refuse = (changes: boolean) => {
      seen.push(changes);
      if (changes) throw Object.assign(new Error('x'), { code: 'step_up_required' });
    };
    await expect(edit(person.id, { email: mail }, refuse)).rejects.toMatchObject({
      code: 'step_up_required',
    });
    expect(seen).toEqual([false, true]);
    const stored = await personDetail(await theAdmin(), env.DB, person.id);
    expect(stored?.email).toBe(person.email);
    await edit(person.id, { email: mail });
    expect((await personDetail(await theAdmin(), env.DB, person.id))?.email).toBe(mail);
  });

  it('an unchanged form writes no event, and a taken email is email_taken', async () => {
    const a = await addPerson([]);
    const b = await addPerson([]);
    const seq = await headSeq();
    await edit(a.id, {});
    expect(await eventsAfter(seq)).toEqual([]);
    await expect(edit(a.id, { email: b.email.toUpperCase() })).rejects.toMatchObject({
      code: 'email_taken',
    });
  });

  it('an offboarded person, an unknown person and an unknown firm are not_found', async () => {
    const gone = await addPerson([]);
    const admin = await theAdmin();
    await offboard(admin, env.DB, gone.id, T0);
    const live = await addPerson([]);
    await expect(edit(live.id, { firmId: 'missing' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      updatePerson(
        admin,
        env.DB,
        'missing',
        { name: 'x', email: 'x@practice.example', externalCode: null, firmId: HOME },
        T0,
        allow,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(edit(gone.id, { name: 'Late' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('a member scope is refused', async () => {
    const member = await addPerson([]);
    await expect(
      updatePerson(
        await scopeFor(env.DB, member.id),
        env.DB,
        member.id,
        { name: 'x', email: member.email, externalCode: null, firmId: HOME },
        T0,
        allow,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('people.reinstate', () => {
  it('lifts the offboarding with no access until a link is issued and used', async () => {
    const d = deps();
    const admin = await theAdmin();
    const person = await enrolledPerson();
    await offboard(admin, d.db, person.personId, T0);
    const seq = await headSeq();
    await reinstate(admin, d.db, person.personId, T0 + 1000);
    const events = await eventsAfter(seq);
    expect(events.map((e) => e.action)).toEqual(['people.reinstate']);
    expect(events[0]?.target).toBe(`person:${person.personId}`);
    expect(events[0]?.actor_id).toBe(admin.actorId);
    expect(JSON.parse(events[0]?.before_json ?? '{}')).toEqual({ offboarded_at: T0 });
    expect(JSON.parse(events[0]?.after_json ?? '{}')).toEqual({ offboarded_at: null });
    expect((await personDetail(admin, d.db, person.personId))?.offboarded_at).toBeNull();
    const live = (rows: Record<string, unknown>[]) => rows.filter((r) => r.revoked_at === null);
    expect(live(await storedFor('credential', person.personId))).toEqual([]);
    expect(live(await storedFor('session', person.personId))).toEqual([]);
    await expect(
      issueEnrolment(admin, d.db, d.secret, person.personId, T0 + 2000),
    ).resolves.toEqual(expect.any(String));
  });

  it('refuses a person who is not offboarded and a member scope', async () => {
    const admin = await theAdmin();
    const person = await addPerson([]);
    await expect(reinstate(admin, env.DB, person.id, T0)).rejects.toMatchObject({
      code: 'not_found',
    });
    await offboard(admin, env.DB, person.id, T0);
    await expect(
      reinstate(await scopeFor(env.DB, (await addPerson([])).id), env.DB, person.id, T0),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('a firm is named by its client', () => {
  it('renaming the client renames the firm in the people list', async () => {
    const admin = await theAdmin();
    const person = await addPerson([]);
    const firm = (await listFirms(env.DB)).find((f) => f.id === HOME);
    const name = unique('Renamed Firm');
    await renameClient(admin, env.DB, firm?.client_id ?? '', name, T0);
    expect((await personDetail(admin, env.DB, person.id))?.firm_name).toBe(name);
    expect((await listFirms(env.DB)).find((f) => f.id === HOME)?.name).toBe(name);
  });
});
