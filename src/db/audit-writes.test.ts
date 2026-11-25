// One audit event per admin write, with actor, target and before/after, asserted for every Action's write.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { addPerson, adminScope, deps, T0 } from '../../test/helpers/auth';
import { clientWithProject, eventsAfter, headSeq, unique } from '../../test/helpers/reference';
import { emailHash, recordFailure, unlockRecovery } from '../auth/lockout';
import { issueEnrolment } from '../auth/enrol';
import { offboard } from '../auth/offboard';
import { reenrol } from '../auth/revoke';
import { currentEnv } from '../lib/env';
import { addAllAssignments, addAssignment, removeAssignment } from './assignments';
import { archiveClient, createClient, renameClient } from './clients';
import { listFirms } from './firms';
import { createPerson } from './person-create';
import { setProjectTasks } from './project-tasks';
import { archiveProject, createProject, updateProject } from './projects';
import { setGrants } from './role-grants';
import type { Scope } from './scope';
import { archiveTaskCode, createTaskCode, renameTaskCode } from './task-codes';

const kek = () => currentEnv().NOTE_KEK;
const REVOKES = [
  'people.revokeCredentials',
  'people.revokeSessions',
  'people.revokeCodes',
  'people.revokeEnrolments',
];

interface Case {
  action: string;
  run: () => Promise<unknown>;
  target: RegExp;
  before: object | null;
  after: object | null;
  extra?: string[];
}

let admin: Scope;
let project: { id: string; clientId: string };
let person: { id: string; email: string };
let taskId: string;
let cases: Case[];

beforeAll(async () => {
  admin = await adminScope();
  const made = await clientWithProject(admin);
  project = { id: made.project.id, clientId: made.clientId };
  person = await addPerson();
  taskId = (
    await createTaskCode(admin, env.DB, { code: unique('K').replace(/\W/g, ''), name: 'Kind' }, T0)
  ).id;
  const spare = await addPerson();
  const leaver = await addPerson();
  const firm = (await listFirms(env.DB))[0]?.id ?? '';
  const d = deps();
  const mail = `${unique('c').replace(/\W/g, '')}@practice.example`;
  const clientName = unique('Audited');
  const other = (await createClient(admin, env.DB, kek(), unique('Other'), T0)).id;
  const p = (
    action: string,
    run: () => Promise<unknown>,
    before: object | null,
    after: object | null,
    target = /^project:/,
    extra?: string[],
  ): Case => ({ action, run, target, before, after, ...(extra ? { extra } : {}) });
  cases = [
    p(
      'clients.create',
      () => createClient(admin, env.DB, kek(), clientName, T0),
      null,
      { name: clientName },
      /^client:/,
    ),
    p(
      'projects.create',
      () =>
        createProject(admin, env.DB, project.clientId, { name: 'Extra', number: '26-0301' }, T0),
      null,
      { number: '26-0301', assigned: [admin.actorId] },
    ),
    p(
      'projects.update',
      () => updateProject(admin, env.DB, project.id, { name: 'Edited', number: '26-0302' }, T0),
      { number: null },
      { name: 'Edited', number: '26-0302' },
    ),
    p(
      'projects.setTasks',
      () => setProjectTasks(admin, env.DB, project.id, [taskId], T0),
      { task_codes: [] },
      { task_codes: [taskId] },
    ),
    p(
      'taskCodes.create',
      () => createTaskCode(admin, env.DB, { code: 'AUD1', name: 'Audit one' }, T0),
      null,
      { code: 'AUD1', name: 'Audit one' },
      /^task_code:/,
    ),
    p(
      'taskCodes.update',
      () => renameTaskCode(admin, env.DB, taskId, 'Kind two', T0),
      { name: 'Kind' },
      { name: 'Kind two' },
      /^task_code:/,
    ),
    p(
      'taskCodes.archive',
      () => archiveTaskCode(admin, env.DB, taskId, false, T0),
      { archived_at: null },
      { archived_at: T0 },
      /^task_code:/,
    ),
    p(
      'assignments.add',
      () => addAssignment(admin, env.DB, project.id, person.id, T0),
      null,
      { person_id: person.id },
      /^assignment:/,
    ),
    p(
      'assignments.remove',
      () => removeAssignment(admin, env.DB, project.id, person.id, T0),
      { person_id: person.id },
      null,
      /^assignment:/,
    ),
    p(
      'projects.archive',
      () => archiveProject(admin, env.DB, project.id, false, T0),
      { archived_at: null },
      { archived_at: T0 },
    ),
    p(
      'clients.update',
      () => renameClient(admin, env.DB, other, 'Renamed Co', T0),
      { name: expect.any(String) as string },
      { name: 'Renamed Co' },
      /^client:/,
    ),
    p(
      'clients.archive',
      () => archiveClient(admin, env.DB, other, false, T0),
      { archived_at: null },
      { archived_at: T0 },
      /^client:/,
    ),
    p(
      'people.create',
      () =>
        createPerson(
          admin,
          env.DB,
          kek(),
          { name: 'Created', email: mail, externalCode: null, firm: { id: firm } },
          T0,
        ),
      null,
      { email: mail, firm_id: firm },
      /^person:/,
    ),
    p(
      'people.setRoles',
      () => setGrants(admin, env.DB, spare.id, ['accounting_admin'], T0),
      { roles: [] },
      { roles: ['accounting_admin'] },
      /^person:/,
    ),
    p(
      'people.issueEnrolment',
      () => issueEnrolment(admin, d.db, d.secret, spare.id, T0),
      null,
      { expires_at: expect.any(Number) as number },
      /^person:/,
    ),
    p(
      'people.reenrol',
      () => reenrol(admin, d.db, d.secret, spare.id, T0),
      null,
      { expires_at: expect.any(Number) as number },
      /^person:/,
      REVOKES,
    ),
    p(
      'people.unlock',
      async () => {
        await recordFailure(d.db, await emailHash(d.secret, spare.email), T0, true);
        await unlockRecovery(admin, d.db, d.secret, spare.id, T0);
      },
      { failures: 1 },
      null,
      /^person:/,
    ),
    p(
      'people.offboard',
      () => offboard(admin, d.db, leaver.id, T0),
      { offboarded_at: null },
      { offboarded_at: T0 },
      /^person:/,
      REVOKES,
    ),
  ];
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

describe('every admin write is audited once', () => {
  it('each Action write adds exactly one event of its own name with actor, target, before and after', async () => {
    expect(cases).toHaveLength(18);
    for (const c of cases) {
      const seq = await headSeq();
      await c.run();
      const events = await eventsAfter(seq);
      const own = events.filter((e) => e.action === c.action);
      expect(own, c.action).toHaveLength(1);
      expect(events.map((e) => e.action).toSorted(), c.action).toEqual(
        [c.action, ...(c.extra ?? [])].toSorted(),
      );
      const [event] = own;
      expect(event?.actor_id, c.action).toBe(admin.actorId);
      expect(event?.target, c.action).toMatch(c.target);
      const before: unknown = event?.before_json ? JSON.parse(event.before_json) : null;
      const after: unknown = event?.after_json ? JSON.parse(event.after_json) : null;
      if (c.before) expect(before, c.action).toMatchObject(c.before);
      else expect(before, c.action).toBeNull();
      if (c.after) expect(after, c.action).toMatchObject(c.after);
      else expect(after, c.action).toBeNull();
    }
  });

  it('a write that fails leaves no event, and a refused duplicate leaves none either', async () => {
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
