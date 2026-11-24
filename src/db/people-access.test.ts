// What the people pages show beside each person: whether they can sign in, whether a link is waiting, and the
// projects they are assigned to.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { addPerson, adminScope, T0, withPasskey, HOUR } from '../../test/helpers/auth';
import { project } from '../../test/helpers/booking';
import { caller } from '../../test/helpers/callers';
import { insertEnrolment } from './enrolments';
import { accessByPerson, assignmentsOf } from './people-access';

describe('who can sign in, and what they are assigned to', () => {
  it('counts a person’s live passkeys and open enrolment links, and nothing for a person with neither', async () => {
    const enrolled = await addPerson();
    const waiting = await addPerson();
    const bare = await addPerson();
    await withPasskey(enrolled.id);
    await withPasskey(enrolled.id);
    await insertEnrolment(env.DB, {
      tokenHash: `h-${waiting.id}`,
      personId: waiting.id,
      expiresAt: T0 + HOUR,
    }).run();
    await insertEnrolment(env.DB, {
      tokenHash: `old-${waiting.id}`,
      personId: waiting.id,
      expiresAt: T0 - HOUR,
    }).run();
    const access = await accessByPerson(env.DB, T0);
    expect(access.get(enrolled.id)).toEqual({ passkeys: 2, openLinks: 0 });
    expect(access.get(waiting.id)).toEqual({ passkeys: 0, openLinks: 1 });
    expect(access.get(bare.id) ?? { passkeys: 0, openLinks: 0 }).toEqual({
      passkeys: 0,
      openLinks: 0,
    });
  });

  it('lists the projects a person is assigned to with their client, newest first, and nothing for an unassigned one', async () => {
    const admin = await adminScope();
    const who = await caller();
    const first = await project(admin, who, 1);
    const second = await project(admin, who, 1);
    const unassigned = await caller();
    const listed = await assignmentsOf(admin, env.DB, who.personId);
    expect(listed.map((a) => a.project_id).toSorted()).toEqual(
      [first.projectId, second.projectId].toSorted(),
    );
    expect(await assignmentsOf(admin, env.DB, unassigned.personId)).toEqual([]);
  });

  it('a member scope is refused', async () => {
    const who = await caller();
    const { scopeFor } = await import('./scope');
    const member = await scopeFor(env.DB, who.personId);
    await expect(assignmentsOf(member, env.DB, who.personId)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});
