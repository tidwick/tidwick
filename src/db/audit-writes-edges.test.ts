// Audit edges: a bulk assignment writes one event per project, and a refused write leaves none.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { addPerson, adminScope, T0 } from '../../test/helpers/auth';
import { clientWithProject, eventsAfter, headSeq } from '../../test/helpers/reference';
import { addAllAssignments, removeAssignment } from './assignments';
import type { Scope } from './scope';
import { createTaskCode } from './task-codes';

let admin: Scope;
let project: { id: string };
let person: { id: string };

beforeAll(async () => {
  admin = await adminScope();
  project = (await clientWithProject(admin)).project;
  person = await addPerson();
});

describe('assign to all live projects', () => {
  it("the Action 'assignments.addAll' writes one assignments.add event per project added, by the admin, and nothing else", async () => {
    const who = await addPerson();
    const seq = await headSeq();
    const added = await addAllAssignments(admin, env.DB, who.id, T0);
    const events = await eventsAfter(seq);
    expect(added).toBeGreaterThan(0);
    expect(events.map((e) => e.action)).toEqual(Array<string>(added).fill('assignments.add'));
    expect(events.every((e) => e.actor_id === admin.actorId)).toBe(true);
  });
});

describe('a refused write', () => {
  it('a write that fails leaves no event, and a refused duplicate leaves none either', async () => {
    await createTaskCode(admin, env.DB, { code: 'AUD1', name: 'Audit one' }, T0);
    const seq = await headSeq();
    await expect(
      createTaskCode(admin, env.DB, { code: 'aud1', name: 'Again' }, T0),
    ).rejects.toMatchObject({ code: 'code_taken' });
    await expect(removeAssignment(admin, env.DB, project.id, person.id, T0)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(await eventsAfter(seq)).toEqual([]);
  });
});
