// The admin data Actions through the built Worker: each does its write, answers 200, and leaves exactly one
// event of its own name; failures answer with the catalog status; the no-script pages post the same forms.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { eventsAfter, headSeq } from '../../../test/helpers/reference';
import { T0, ACCOUNTING, ADMIN } from '../../../test/helpers/auth';
import {
  caller,
  formPost,
  getPage,
  rpcForm,
  type Caller,
  type Fields,
} from '../../../test/helpers/callers';
import { emailHash, recordFailure } from '../../auth/lockout';
import { idOf } from '../../db/test-support';
import { currentEnv } from '../../lib/env';

const REVOKES = [
  'people.revokeCredentials',
  'people.revokeSessions',
  'people.revokeCodes',
  'people.revokeEnrolments',
];

/** Calls an Action, expects 200, and checks it left one event of its own name plus any named extras. */
async function does(
  name: string,
  who: Caller,
  fields: Fields,
  extra: string[] = [],
): Promise<void> {
  const seq = await headSeq();
  const response = await rpcForm(name, who, fields);
  expect(response.status, `${name}: ${await response.clone().text()}`).toBe(200);
  const events = await eventsAfter(seq);
  expect(events.map((e) => e.action).toSorted(), name).toEqual([name, ...extra].toSorted());
  expect(events.find((e) => e.action === name)?.actor_id, name).toBe(who.personId);
}

describe('the admin data Actions', () => {
  it('each Action writes once, is audited once, and the whole reference-data journey works', async () => {
    const admin = await caller([ADMIN]);
    const other = await caller([]);
    const tag = String(Date.now() % 10000).padStart(4, '0');

    await does('clients.create', admin, { name: `Moss Bank ${tag}` });
    const clientId = await idOf(env.DB, 'client', `Moss Bank ${tag}`);
    await does('projects.create', admin, {
      clientId,
      name: 'Roof',
      number: `26-${tag}`,
    });
    const projectId = await idOf(env.DB, 'project', clientId);
    await does('taskCodes.create', admin, { code: `D${tag}`, name: 'Detail' });
    await does('taskCodes.create', admin, { code: `E${tag}`, name: 'Estimate' });
    const t1 = await idOf(env.DB, 'task_code', `D${tag}`);
    const t2 = await idOf(env.DB, 'task_code', `E${tag}`);
    await does('projects.setTasks', admin, { id: projectId, taskCodeIds: [t1, t2] });
    await does('assignments.add', admin, { projectId, personId: other.personId });
    await does('assignments.remove', admin, { projectId, personId: other.personId });
    await does('projects.update', admin, { id: projectId, name: 'Roof and gutters', number: '' });
    await does('taskCodes.update', admin, { id: t1, name: 'Detailing' });
    await does('taskCodes.archive', admin, { id: t1 });
    await does('projects.archive', admin, { id: projectId });
    await does('clients.update', admin, { id: clientId, name: `Moss Bank Ltd ${tag}` });
    await does('clients.archive', admin, { id: clientId });

    const email = `new${tag}@practice.example`;
    await does('people.create', admin, { name: 'New Hire', email, newFirm: `Fennel & Co ${tag}` });
    const personId = await idOf(env.DB, 'person', email);
    await does('people.setRoles', admin, { id: personId, grants: ACCOUNTING });
    await does('people.issueEnrolment', admin, { id: personId });
    await does('people.reenrol', admin, { id: personId }, REVOKES);
    await recordFailure(env.DB, await emailHash(currentEnv().SESSION_SECRET, email), T0, true);
    await does('people.unlock', admin, { id: personId });
    await does('people.offboard', admin, { id: personId }, REVOKES);
  });

  it('failures answer with the catalog status and write nothing', async () => {
    const admin = await caller([ADMIN]);
    const member = await caller([]);
    const name = `Taken ${String(Date.now() % 100000)}`;
    expect((await rpcForm('clients.create', admin, { name })).status).toBe(200);
    expect((await rpcForm('clients.create', member, { name })).status).toBe(403);
    const seq = await headSeq();
    const clash = await rpcForm('clients.create', admin, { name: name.toLowerCase() });
    expect(clash.status).toBe(409);
    const clientId = await idOf(env.DB, 'client', name);
    expect(
      (await rpcForm('projects.create', admin, { clientId, name: 'X', number: '26-12' })).status,
    ).toBe(400);
    expect(
      (await rpcForm('projects.create', admin, { clientId: 'missing', name: 'X' })).status,
    ).toBe(404);
    expect((await rpcForm('clients.create', admin, { name: '   ' })).status).toBe(400);
    expect(
      (await rpcForm('people.create', admin, { name: 'A', email: 'not-an-email', newFirm: 'F' }))
        .status,
    ).toBe(400);
    expect(
      (await rpcForm('people.create', admin, { name: 'A', email: 'a@b.example' })).status,
    ).toBe(400);
    expect(await eventsAfter(seq)).toEqual([]);
  });
});

describe('the admin pages without script', () => {
  it('an admin creates a client from the form and lands on it; a member sees it only once assigned, and no form', async () => {
    const admin = await caller([ADMIN]);
    const member = await caller([]);
    const name = `Pine Row ${String(Date.now() % 100000)}`;
    const posted = await formPost('/clients', 'clients.create', admin, { name });
    expect(posted.status).toBe(303);
    const clientId = await idOf(env.DB, 'client', name);
    expect(posted.headers.get('location')).toBe(`/clients/${clientId}?saved=1`);
    expect(await (await getPage(`/clients/${clientId}`, admin)).text()).toContain(name);
    expect(await (await getPage('/clients', admin)).text()).toContain('Add client');
    expect((await getPage(`/clients/${clientId}`, member)).status).toBe(404);
    const list = await (await getPage('/clients', member)).text();
    expect(list).not.toContain(name);
    expect(list).not.toContain('Add client');
    const refused = await formPost('/clients', 'clients.create', member, { name: `${name} 2` });
    expect(refused.status).toBe(403);
  });

  it('a refused New project keeps the chosen client selected', async () => {
    const admin = await caller([ADMIN]);
    const tag = String(Date.now() % 100000);
    for (const n of ['Aster', 'Birch'])
      await rpcForm('clients.create', admin, { name: `${n} ${tag}` });
    const second = await idOf(env.DB, 'client', `Birch ${tag}`);
    const page = await formPost('/clients', 'projects.create', admin, {
      clientId: second,
      name: 'X',
      number: 'bad',
    });
    expect(await page.text()).toContain(`value="${second}" selected`);
  });

  it('a form error shows the catalog message on the page', async () => {
    const admin = await caller([ADMIN]);
    const code = `Q${String(Date.now() % 100000)}`;
    expect(
      (await formPost('/admin/task-codes', 'taskCodes.create', admin, { code, name: 'One' }))
        .status,
    ).toBe(303);
    const again = await formPost('/admin/task-codes', 'taskCodes.create', admin, {
      code,
      name: 'Two',
    });
    expect(await again.text()).toContain('That task code is already used');
  });

  it('an enrolment link is shown once to the issuing admin and never again', async () => {
    const admin = await caller([ADMIN]);
    const target = await caller([]);
    const page = `/admin/people/${target.personId}`;
    const issued = await (
      await formPost(page, 'people.issueEnrolment', admin, { id: target.personId })
    ).text();
    expect(issued).toMatch(/http:\/\/localhost:4321\/enrol\/[A-Za-z0-9_-]{43}/);
    expect(await (await getPage(page, admin)).text()).not.toContain('/enrol/');
  });

  it('the admin pages are closed to a member and open to an admin', async () => {
    const member = await caller([]);
    const admin = await caller([ADMIN]);
    for (const page of ['/admin/people', '/admin/task-codes', `/admin/people/${admin.personId}`]) {
      expect((await getPage(page, member)).status, page).toBe(403);
      expect((await getPage(page, admin)).status, page).toBe(200);
    }
  });
});
