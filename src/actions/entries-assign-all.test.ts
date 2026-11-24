// One person can be assigned to every live project at once from their admin page.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ADMIN, T0 } from '../../test/helpers/auth';
import { booking, project } from '../../test/helpers/booking';
import { caller, formPost, rpcForm } from '../../test/helpers/callers';
import { eventsAfter } from '../../test/helpers/reference';
import { addAllAssignments, assignedTo as assignedPeople } from '../db/assignments';
import { archiveProject } from '../db/projects';

const assignedTo = async (
  projectId: string,
  personId: string,
  who: Parameters<typeof assignedPeople>[0],
) => (await assignedPeople(who, env.DB, projectId)).some((p) => p.person_id === personId);

const events = async (projectId: string, personId: string) =>
  (await eventsAfter(0))
    .filter((e) => e.target === `assignment:${projectId}:${personId}`)
    .map((e) => e.action);

describe('assign to all live projects', () => {
  it('assigns every live project once, skips archived, and a repeat adds none', async () => {
    const b = await booking();
    const second = await project(b.admin, b.who, 1, false);
    const gone = await project(b.admin, b.who, 1, false);
    await archiveProject(b.admin, env.DB, gone.projectId, false, T0);
    const target = await caller();
    const added = await addAllAssignments(b.admin, env.DB, target.personId, T0);
    expect(added).toBeGreaterThanOrEqual(2);
    expect(await assignedTo(b.projectId, target.personId, b.admin)).toBe(true);
    expect(await assignedTo(second.projectId, target.personId, b.admin)).toBe(true);
    expect(await assignedTo(gone.projectId, target.personId, b.admin)).toBe(false);
    expect(await events(second.projectId, target.personId)).toEqual(['assignments.add']);
    expect(await addAllAssignments(b.admin, env.DB, target.personId, T0)).toBe(0);
  });

  it('the Action assigns for an admin and is refused for a member, who gains nothing', async () => {
    const b = await booking();
    const target = await caller();
    const refused = await rpcForm('assignments.addAll', b.who, { personId: target.personId });
    expect(refused.status).toBe(403);
    expect(await assignedTo(b.projectId, target.personId, b.admin)).toBe(false);
    const own = await formPost('/account', 'assignments.addAll', b.who, {
      personId: b.who.personId,
    });
    expect(own.status).toBe(403);
    const boss = await caller([ADMIN]);
    const done = await rpcForm('assignments.addAll', boss, { personId: target.personId });
    expect(done.status).toBe(200);
    expect(await assignedTo(b.projectId, target.personId, b.admin)).toBe(true);
  });
});
