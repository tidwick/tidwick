import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../test/seed/build';
import { loadSeed } from '../../test/seed/load';
import { offboard } from '../auth/offboard';
import { issueEnrolment } from '../auth/enrol';
import { reenrol } from '../auth/revoke';
import { unlockRecovery } from '../auth/lockout';
import { currentEnv } from '../lib/env';
import { addAllAssignments, addAssignment, removeAssignment } from './assignments';
import { claimInstance, type BootstrapInput } from './bootstrap';
import { archiveClient, createClient, renameClient } from './clients';
import { listPeople, personDetail } from './people';
import { createPerson } from './person-create';
import { setProjectTasks } from './project-tasks';
import { archiveProject, createProject, updateProject } from './projects';
import { setGrants } from './role-grants';
import { ceremonyScope, requireAll, scopeFor, systemScope, type Scope } from './scope';
import { archiveTaskCode, createTaskCode, renameTaskCode } from './task-codes';

const MEMBER = SEED_IDS.person(3);
const ID = 'x';
const NOW = 1;
let member: Scope;

beforeAll(async () => {
  await loadSeed(env.DB, currentEnv().NOTE_KEK);
  member = await scopeFor(env.DB, MEMBER);
});

const CLAIM: BootstrapInput = {
  email: 'a@example.test',
  name: 'n',
  firm: 'f',
  personId: 'p',
  firmId: 'f',
  clientId: 'c',
  key: { wrapped: new Uint8Array(1), iv: new Uint8Array(1), kekId: 'k' },
  enrolmentHash: 'h',
  now: NOW,
};

const kek = () => currentEnv().NOTE_KEK;

describe('the domain refuses privileged calls by scope kind', () => {
  it('requireAll passes an all-clients scope and refuses a member scope', () => {
    expect(() => {
      requireAll(systemScope());
    }).not.toThrow();
    expect(() => {
      requireAll(member);
    }).toThrow(expect.objectContaining({ code: 'forbidden' }));
  });

  it('a member scope is refused by every steward-only and admin-only mutator', async () => {
    const db = env.DB;
    const calls: (() => Promise<unknown>)[] = [
      () => addAssignment(member, db, ID, ID, NOW),
      () => removeAssignment(member, db, ID, ID, NOW),
      () => addAllAssignments(member, db, ID, NOW),
      () => renameClient(member, db, ID, 'n', NOW),
      () => archiveClient(member, db, ID, false, NOW),
      () => updateProject(member, db, ID, { name: 'n', number: '' }, NOW),
      () => archiveProject(member, db, ID, false, NOW),
      () => setProjectTasks(member, db, ID, [], NOW),
      () => createTaskCode(member, db, { code: 'ZZ', name: 'n' }, NOW),
      () => renameTaskCode(member, db, ID, 'n', NOW),
      () => archiveTaskCode(member, db, ID, false, NOW),
      () =>
        createPerson(
          member,
          db,
          kek(),
          {
            name: 'n',
            email: 'n@example.test',
            externalCode: null,
            firm: { newName: 'f' },
          },
          NOW,
        ),
      () => setGrants(member, db, ID, ['admin'], NOW),
      () => offboard(member, db, ID, NOW),
      () => issueEnrolment(member, db, 'secret', ID, NOW),
      () => reenrol(member, db, 'secret', ID, NOW),
      () => unlockRecovery(member, db, 'secret', ID, NOW),
      () => listPeople(member, db),
      () => personDetail(member, db, ID),
      () => claimInstance(member, db, CLAIM),
    ];
    for (const [i, call] of calls.entries()) {
      await expect(call(), `call ${String(i)}`).rejects.toMatchObject({ code: 'forbidden' });
    }
  });

  it('a member scope cannot create a client or a project', async () => {
    await expect(createClient(member, env.DB, kek(), 'Member made', NOW)).rejects.toMatchObject({
      code: 'forbidden',
    });
    const own = await env.DB.prepare(
      'SELECT p.client_id FROM assignment a JOIN project p ON p.id = a.project_id WHERE a.person_id = ?1 LIMIT 1',
    )
      .bind(MEMBER)
      .first<{ client_id: string }>();
    const clientId = own?.client_id ?? expect.unreachable('member has no project');
    await expect(
      createProject(member, env.DB, clientId, { name: 'P', number: '' }, NOW),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('an all-clients scope reads people', async () => {
    expect((await listPeople(systemScope(), env.DB)).length).toBeGreaterThan(0);
    expect((await personDetail(systemScope(), env.DB, MEMBER))?.id).toBe(MEMBER);
  });

  it('only a ceremony scope with no actor may claim: an all-clients scope and a person’s ceremony scope are refused', async () => {
    for (const scope of [systemScope(), ceremonyScope(MEMBER)]) {
      await expect(claimInstance(scope, env.DB, CLAIM)).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
  });
});
