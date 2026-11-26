// One person can be assigned to every live project at once from their admin page.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ADMIN, T0 } from '../../test/helpers/auth';
import { booking, project } from '../../test/helpers/booking';
import { caller, formPost, getPage, rpcForm } from '../../test/helpers/callers';
import { eventsAfter } from '../../test/helpers/reference';
import { ASSIGN_ALL_MAX, addAllAssignments, assignedTo as assignedPeople } from '../db/assignments';
import { D1_QUERIES_PER_INVOCATION } from '../lib/limits';
import { countingDb, seedProjects } from '../db/test-support';
import { assignableProjects } from '../db/people-access';
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

  it('one call adds at most the cap, and a repeat adds the rest', async () => {
    const b = await booking();
    await project(b.admin, b.who, 1, false);
    await project(b.admin, b.who, 1, false);
    const target = await caller();
    const left = (await assignableProjects(b.admin, env.DB, target.personId)).length;
    expect(left).toBeGreaterThanOrEqual(3);
    expect(await addAllAssignments(b.admin, env.DB, target.personId, T0, 2)).toBe(2);
    expect(await assignableProjects(b.admin, env.DB, target.personId)).toHaveLength(left - 2);
    expect(await addAllAssignments(b.admin, env.DB, target.personId, T0, 2)).toBe(2);
  });

  it('at the default cap one press stays inside the query budget even if the batch is retried', async () => {
    const b = await booking();
    const target = await caller();
    await seedProjects(env.DB, b.clientId, ASSIGN_ALL_MAX + 1, T0);
    const counted = countingDb(env.DB);
    expect(await addAllAssignments(b.admin, counted.db, target.personId, T0)).toBe(ASSIGN_ALL_MAX);
    expect(2 * counted.count()).toBeLessThan(D1_QUERIES_PER_INVOCATION);
  });
});

describe('the person page assigns and removes one project at a time', () => {
  it('lists a select of unassigned projects, assigns one, removes it, and refuses a member', async () => {
    const b = await booking();
    const target = await caller();
    const boss = await caller([ADMIN]);
    const page = `/admin/people/${target.personId}`;
    const before = await (await getPage(page, boss)).text();
    expect(before).toContain('name="projectId"');
    expect(before).toContain('Assign to all live projects');

    const added = await formPost(page, 'assignments.add', boss, {
      projectId: b.projectId,
      personId: target.personId,
    });
    expect(added.status).toBe(303);
    expect(await assignedTo(b.projectId, target.personId, b.admin)).toBe(true);
    const listed = await (await getPage(page, boss)).text();
    expect(listed).toMatch(/aria-label="Remove [^"]+ from /);
    expect(
      (await assignableProjects(b.admin, env.DB, target.personId)).map((p) => p.id),
    ).not.toContain(b.projectId);

    const denied = await rpcForm('assignments.remove', b.who, {
      projectId: b.projectId,
      personId: target.personId,
    });
    expect(denied.status).toBe(403);
    const removed = await formPost(page, 'assignments.remove', boss, {
      projectId: b.projectId,
      personId: target.personId,
    });
    expect(removed.status).toBe(303);
    expect(await assignedTo(b.projectId, target.personId, b.admin)).toBe(false);
  });
});
