import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { clientWithProject, memberScope, unique } from '../../test/helpers/reference';
import { adminScope, T0 } from '../../test/helpers/auth';
import { currentEnv } from '../lib/env';
import { archiveClient, createClient } from './clients';
import { scopeFor } from './scope';
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

  it('the creator is assigned, so a member sees the project they made', async () => {
    const { id, scope } = await memberScope();
    const { clientId: cid, project } = await clientWithProject(scope);
    const rows = await env.DB.prepare('SELECT person_id FROM assignment WHERE project_id = ?1')
      .bind(project.id)
      .all<{ person_id: string }>();
    expect(rows.results.map((r) => r.person_id)).toEqual([id]);
    const fresh = await scopeFor(env.DB, id);
    expect((await listProjects(fresh, env.DB, cid)).map((p) => p.id)).toEqual([project.id]);
  });

  it('a member creating a project learns nothing about numbers outside their scope', async () => {
    const admin = await adminScope();
    await createProject(
      admin,
      env.DB,
      await clientId(),
      { name: unique('Hidden'), number: '26-0901' },
      T0,
    );
    const { id, scope } = await memberScope();
    const { clientId: own, project } = await clientWithProject(scope);
    const member = await scopeFor(env.DB, id);
    const codes: (string | undefined)[] = [];
    for (const number of ['26-0901', '26-0902']) {
      const refused = await createProject(
        member,
        env.DB,
        own,
        { name: project.name, number },
        T0,
      ).catch((error: unknown) => error);
      codes.push((refused as { code?: string }).code);
    }
    expect(codes).toEqual(['name_taken', 'name_taken']);
  });

  it('a project cannot be created under an archived or an unseen client', async () => {
    const admin = await adminScope();
    const { scope: member } = await memberScope();
    const id = await clientId();
    await expect(
      createProject(member, env.DB, id, { name: 'Nope', number: '' }, T0),
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
