import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { clientWithProject, memberScope, unique } from '../../test/helpers/reference';
import { adminScope, T0 } from '../../test/helpers/auth';
import { currentEnv } from '../lib/env';
import { archiveClient, createClient } from './clients';
import {
  archiveProject,
  createProject,
  listProjects,
  projectById,
  updateProject,
} from './projects';

async function clientId(): Promise<string> {
  const scope = await adminScope();
  return (await createClient(scope, env.DB, currentEnv().NOTE_KEK, unique('Client'), T0)).id;
}

describe('project numbers', () => {
  it('a project number is optional', async () => {
    const scope = await adminScope();
    const id = await clientId();
    const a = await createProject(scope, env.DB, id, { name: 'One', number: '' }, T0);
    const b = await createProject(scope, env.DB, id, { name: 'Two', number: '   ' }, T0);
    expect(a.number).toBeNull();
    expect(b.number).toBeNull();
    expect((await projectById(scope, env.DB, a.id))?.number).toBeNull();
  });

  it('a project number is unique when set, across clients', async () => {
    const scope = await adminScope();
    const number = '26-0101';
    await createProject(scope, env.DB, await clientId(), { name: 'First', number }, T0);
    await expect(
      createProject(scope, env.DB, await clientId(), { name: 'Second', number }, T0),
    ).rejects.toMatchObject({ code: 'number_taken' });
    const other = await createProject(
      scope,
      env.DB,
      await clientId(),
      { name: 'Third', number: '26-0102' },
      T0,
    );
    await expect(
      updateProject(scope, env.DB, other.id, { name: 'Third', number }, T0),
    ).rejects.toMatchObject({ code: 'number_taken' });
  });

  it('a malformed project number is rejected before it is stored, and the schema refuses it too', async () => {
    const scope = await adminScope();
    const id = await clientId();
    for (const bad of ['26-001', '2026-0001', 'ab-cdef', '26_0001', '26-00012', '٢٦-٠٠٠١']) {
      await expect(
        createProject(scope, env.DB, id, { name: unique('Bad'), number: bad }, T0),
      ).rejects.toMatchObject({ code: 'invalid_input' });
    }
    const insert = env.DB.prepare(
      "INSERT INTO project (id, client_id, name, number, created_at) VALUES ('bad-number', ?1, 'Bad', '26-001', 1)",
    ).bind(id);
    await expect(insert.run()).rejects.toThrow(/CHECK constraint failed/);
  });

  it('a project number is required when the setting is on', async () => {
    const scope = await adminScope();
    const id = await clientId();
    await env.DB.exec(
      "INSERT INTO setting (key, value_json) VALUES ('project_number_required', 'true');",
    );
    try {
      await expect(
        createProject(scope, env.DB, id, { name: unique('Needs'), number: '' }, T0),
      ).rejects.toMatchObject({ code: 'number_required' });
      const ok = await createProject(
        scope,
        env.DB,
        id,
        { name: unique('Has'), number: '26-0201' },
        T0,
      );
      await expect(
        updateProject(scope, env.DB, ok.id, { name: 'Has', number: '' }, T0),
      ).rejects.toMatchObject({ code: 'number_required' });
    } finally {
      await env.DB.exec("DELETE FROM setting WHERE key = 'project_number_required';");
    }
  });
});

describe('projects', () => {
  it('a project name is unique within its client ignoring case, and free across clients', async () => {
    const scope = await adminScope();
    const a = await clientId();
    await createProject(scope, env.DB, a, { name: 'Alpha', number: '' }, T0);
    await expect(
      createProject(scope, env.DB, a, { name: 'ALPHA', number: '' }, T0),
    ).rejects.toMatchObject({ code: 'name_taken' });
    await createProject(scope, env.DB, await clientId(), { name: 'Alpha', number: '' }, T0);
  });

  it('the creator is assigned, and a member scope cannot create a project', async () => {
    const admin = await adminScope();
    const { clientId: cid, project } = await clientWithProject(admin);
    const rows = await env.DB.prepare('SELECT person_id FROM assignment WHERE project_id = ?1')
      .bind(project.id)
      .all<{ person_id: string }>();
    expect(rows.results.map((r) => r.person_id)).toEqual([admin.actorId]);
    const { scope: member } = await memberScope();
    await expect(
      createProject(member, env.DB, cid, { name: unique('Nope'), number: '26-0902' }, T0),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(listProjects(member, env.DB, cid)).resolves.toEqual([]);
  });

  it('a project cannot be created under an archived or an unknown client', async () => {
    const admin = await adminScope();
    const id = await clientId();
    await expect(
      createProject(admin, env.DB, 'missing', { name: 'Nope', number: '' }, T0),
    ).rejects.toMatchObject({ code: 'not_found' });
    await archiveClient(admin, env.DB, id, false, T0);
    await expect(
      createProject(admin, env.DB, id, { name: 'Late', number: '' }, T0),
    ).rejects.toMatchObject({ code: 'archived' });
  });

  it('a project is archived and restored, never deleted, and the wrong direction is refused', async () => {
    const scope = await adminScope();
    const { project } = await clientWithProject(scope);
    await archiveProject(scope, env.DB, project.id, false, T0);
    expect((await projectById(scope, env.DB, project.id))?.archived_at).toBe(T0);
    await expect(archiveProject(scope, env.DB, project.id, false, T0)).rejects.toMatchObject({
      code: 'bad_transition',
    });
    await expect(
      updateProject(scope, env.DB, project.id, { name: 'Renamed', number: '' }, T0),
    ).rejects.toMatchObject({ code: 'archived' });
    await archiveProject(scope, env.DB, project.id, true, T0);
    expect((await projectById(scope, env.DB, project.id))?.archived_at).toBeNull();
  });
});
