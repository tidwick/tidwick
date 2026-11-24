// Add-row for an all-clients scope lists every live project and a pick assigns the person through the audited
// write; a member still sees only assigned projects. The empty add-row names its cause.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ADMIN, T0, adminScope } from '../../test/helpers/auth';
import { eventsAfter } from '../../test/helpers/reference';
import { project, weekOf, WEEK } from '../../test/helpers/booking';
import { booking } from '../../test/helpers/booking';
import { caller, getPage, rpcForm } from '../../test/helpers/callers';
import { assignedTo as assignedPeople } from '../db/assignments';
import { personById } from '../db/people';
import { archiveProject } from '../db/projects';
import { scopeFor } from '../db/scope';
import { emptyCause } from '../db/week-empty';
import { addRowOptions } from '../db/week-view';

const assignedTo = async (projectId: string, personId: string) =>
  (await assignedPeople(await adminScope(), env.DB, projectId)).some(
    (p) => p.person_id === personId,
  );

/** The audit actions written against one assignment, oldest first. */
const events = async (projectId: string, personId: string) =>
  (await eventsAfter(0))
    .filter((e) => e.target === `assignment:${projectId}:${personId}`)
    .map((e) => e.action);

describe('add-row for an admin', () => {
  it('lists every live project with a task, and a pick assigns them with one audited event', async () => {
    const b = await booking();
    const stranger = await project(b.admin, b.who, 2, false);
    const bare = await project(b.admin, b.who, 0, false);
    const gone = await project(b.admin, b.who, 1, false);
    await archiveProject(b.admin, env.DB, gone.projectId, false, T0);
    const boss = await caller([ADMIN]);
    const scope = await scopeFor(env.DB, boss.personId);
    const ids = (await addRowOptions(scope, env.DB, boss.personId)).map((o) => o.projectId);
    expect(ids).toContain(b.projectId);
    expect(ids).toContain(stranger.projectId);
    expect(ids).not.toContain(bare.projectId);
    expect(ids).not.toContain(gone.projectId);

    const task = stranger.tasks[0];
    const response = await rpcForm('entries.addRow', boss, {
      weekStart: WEEK,
      projectId: stranger.projectId,
      taskCodeId: task?.id ?? '',
    });
    expect(response.status).toBe(200);
    expect((await weekOf(boss, WEEK)).rows.map((r) => r.taskCode)).toEqual([task?.code]);
    expect(await assignedTo(stranger.projectId, boss.personId)).toBe(true);
    expect(await events(stranger.projectId, boss.personId)).toEqual(['assignments.add']);
  });

  it('a task the project does not allow is refused and assigns nothing', async () => {
    const b = await booking();
    const stranger = await project(b.admin, b.who, 1, false);
    const other = await project(b.admin, b.who, 1, false);
    const boss = await caller([ADMIN]);
    const response = await rpcForm('entries.addRow', boss, {
      weekStart: WEEK,
      projectId: stranger.projectId,
      taskCodeId: other.tasks[0]?.id ?? '',
    });
    expect(response.status).toBe(400);
    expect(await assignedTo(stranger.projectId, boss.personId)).toBe(false);
  });
});

describe('add-row for a member', () => {
  it('lists only assigned projects and cannot self-assign by picking another', async () => {
    const b = await booking();
    const stranger = await project(b.admin, b.who, 1, false);
    const scope = await scopeFor(env.DB, b.who.personId);
    const ids = (await addRowOptions(scope, env.DB, b.who.personId)).map((o) => o.projectId);
    expect(ids).toEqual([b.projectId]);
    const response = await rpcForm('entries.addRow', b.who, {
      weekStart: WEEK,
      projectId: stranger.projectId,
      taskCodeId: stranger.tasks[0]?.id ?? '',
    });
    expect(response.status).toBe(403);
    expect(await assignedTo(stranger.projectId, b.who.personId)).toBe(false);
    expect((await weekOf(b.who, WEEK)).rows).toEqual([]);
  });
});

describe('the cause of an empty add-row', () => {
  it('names the stewards to ask for an unassigned member', async () => {
    const boss = await caller([ADMIN]);
    const who = await caller();
    const scope = await scopeFor(env.DB, who.personId);
    const cause = await emptyCause(scope, env.DB, who.personId);
    expect(cause.kind).toBe('unassigned');
    if (cause.kind !== 'unassigned') return;
    const name = (await personById(env.DB, boss.personId))?.name;
    expect(cause.stewards).toContain(name);
  });

  it('names the project that has no tasks, for its assignee and for a steward', async () => {
    const admin = await adminScope();
    const who = await caller();
    const bare = await project(admin, who, 0);
    const own = await scopeFor(env.DB, who.personId);
    expect(await emptyCause(own, env.DB, who.personId)).toEqual({
      kind: 'no_tasks',
      projects: [{ projectId: bare.projectId, name: expect.any(String) as string }],
    });
    const boss = await caller([ADMIN]);
    const all = await emptyCause(await scopeFor(env.DB, boss.personId), env.DB, boss.personId);
    expect(
      all.kind === 'no_tasks' && all.projects.some((p) => p.projectId === bare.projectId),
    ).toBe(true);
  });

  it('the project page tells a steward that nobody can book time to a project with no tasks', async () => {
    const admin = await adminScope();
    const who = await caller();
    const bare = await project(admin, who, 0);
    const boss = await caller([ADMIN]);
    expect(await (await getPage(`/projects/${bare.projectId}`, boss)).text()).toContain(
      'Nobody can book time here',
    );
    const seen = await (await getPage(`/projects/${bare.projectId}`, who)).text();
    expect(seen).toContain('No task is allowed yet');
    expect(seen).not.toContain('Nobody can book time here');
  });
});
