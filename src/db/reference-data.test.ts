import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { adminScope, T0 } from '../../test/helpers/auth';
import { clientWithProject, memberScope, unique } from '../../test/helpers/reference';
import { addAssignment, assignedTo, removeAssignment } from './assignments';
import { clientById } from './clients';
import { allowedTasks, setProjectTasks } from './project-tasks';
import { scopeFor } from './scope';
import { archiveTaskCode, createTaskCode, listTaskCodes, renameTaskCode } from './task-codes';

async function codes(n: number): Promise<string[]> {
  const scope = await adminScope();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const code = unique('T').replace(/\W/g, '');
    ids.push((await createTaskCode(scope, env.DB, { code, name: `Task ${code}` }, T0)).id);
  }
  return ids;
}

describe('task codes', () => {
  it('a task code is unique ignoring case and keeps its code when renamed', async () => {
    const scope = await adminScope();
    const made = await createTaskCode(scope, env.DB, { code: 'Zeta1', name: 'Zeta' }, T0);
    await expect(
      createTaskCode(scope, env.DB, { code: 'ZETA1', name: 'Other' }, T0),
    ).rejects.toMatchObject({ code: 'code_taken' });
    await renameTaskCode(scope, env.DB, made.id, 'Zeta renamed', T0);
    const row = (await listTaskCodes(env.DB)).find((c) => c.id === made.id);
    expect(row).toMatchObject({ code: 'Zeta1', name: 'Zeta renamed' });
  });

  it('a task code is archived and restored, and archived codes list after live ones', async () => {
    const scope = await adminScope();
    const [id = ''] = await codes(1);
    await archiveTaskCode(scope, env.DB, id, false, T0);
    await expect(archiveTaskCode(scope, env.DB, id, false, T0)).rejects.toMatchObject({
      code: 'bad_transition',
    });
    const all = await listTaskCodes(env.DB);
    const firstArchived = all.findIndex((c) => c.archived_at !== null);
    expect(all.slice(firstArchived).every((c) => c.archived_at !== null)).toBe(true);
    await archiveTaskCode(scope, env.DB, id, true, T0);
  });
});

describe('allowed tasks per project', () => {
  it('the allowed list is replaced as a set, keeps archived rows, and refuses unknown or archived codes', async () => {
    const scope = await adminScope();
    const { project } = await clientWithProject(scope);
    const [a = '', b = '', c = ''] = await codes(3);
    await setProjectTasks(scope, env.DB, project.id, [a, b, a], T0);
    expect(
      (await allowedTasks(scope, env.DB, project.id)).map((t) => t.task_code_id).toSorted(),
    ).toEqual([a, b].toSorted());
    await setProjectTasks(scope, env.DB, project.id, [b, c], T0);
    expect(
      (await allowedTasks(scope, env.DB, project.id)).map((t) => t.task_code_id).toSorted(),
    ).toEqual([b, c].toSorted());
    const stored = await env.DB.prepare(
      'SELECT task_code_id, archived_at FROM project_task WHERE project_id = ?1 ORDER BY task_code_id',
    )
      .bind(project.id)
      .all<{ task_code_id: string; archived_at: number | null }>();
    expect(stored.results).toHaveLength(3);
    expect(stored.results.find((r) => r.task_code_id === a)?.archived_at).toBe(T0);
    await setProjectTasks(scope, env.DB, project.id, [a], T0);
    expect(stored.results).toHaveLength(3);
    expect((await allowedTasks(scope, env.DB, project.id)).map((t) => t.task_code_id)).toEqual([a]);
    await expect(setProjectTasks(scope, env.DB, project.id, ['nope'], T0)).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await archiveTaskCode(scope, env.DB, b, false, T0);
    await expect(setProjectTasks(scope, env.DB, project.id, [a, b], T0)).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });

  it('a member reads allowed tasks only for a project they are assigned to', async () => {
    const admin = await adminScope();
    const { project } = await clientWithProject(admin);
    const { id } = await memberScope();
    const unassigned = await scopeFor(env.DB, id);
    await expect(allowedTasks(unassigned, env.DB, project.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    await addAssignment(admin, env.DB, project.id, id, T0);
    expect(await allowedTasks(await scopeFor(env.DB, id), env.DB, project.id)).toEqual([]);
  });
});

describe('assignments', () => {
  it('a person is assigned once, removed, and a project outside the scope is not found', async () => {
    const admin = await adminScope();
    const { project } = await clientWithProject(admin);
    const { id } = await memberScope();
    await addAssignment(admin, env.DB, project.id, id, T0);
    await expect(addAssignment(admin, env.DB, project.id, id, T0)).rejects.toMatchObject({
      code: 'already_assigned',
    });
    expect((await assignedTo(admin, env.DB, project.id)).map((p) => p.person_id)).toContain(id);
    await removeAssignment(admin, env.DB, project.id, id, T0);
    await expect(removeAssignment(admin, env.DB, project.id, id, T0)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(addAssignment(admin, env.DB, 'missing', id, T0)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(addAssignment(admin, env.DB, project.id, 'nobody', T0)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('assigning a member lets them see the project and its client', async () => {
    const admin = await adminScope();
    const { clientId, project } = await clientWithProject(admin);
    const { id } = await memberScope();
    const before = await scopeFor(env.DB, id);
    expect(before.kind === 'member' && before.projectIds.includes(project.id)).toBe(false);
    await addAssignment(admin, env.DB, project.id, id, T0);
    const after = await scopeFor(env.DB, id);
    expect(after.kind === 'member' && after.projectIds.includes(project.id)).toBe(true);
    expect((await clientById(after, env.DB, clientId))?.id).toBe(clientId);
  });
});
