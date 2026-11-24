// An addition racing a concurrent change that lands between the write's read and its head read: the event left
// behind records the state it replaced.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ACCOUNTING, addPerson, ADMIN, adminScope, T0 } from '../../test/helpers/auth';
import { clientWithProject, unique } from '../../test/helpers/reference';
import { allowedTasks, setProjectTasks } from './project-tasks';
import { setGrants } from './role-grants';
import { grantsOf } from './roles';
import { storedRows } from './stored-rows';
import { createTaskCode } from './task-codes';
import { racingRead } from './test-support';

const HEAD = 'FROM audit_event ORDER BY seq DESC LIMIT 1';

/** The before and after of each event of `action` on `target`, oldest first. */
async function history(action: string, target: string): Promise<[unknown, unknown][]> {
  const events = (await storedRows(env.DB, 'audit_event')).filter(
    (e) => e.action === action && e.target === target,
  );
  return events.map((e) => [JSON.parse(String(e.before_json)), JSON.parse(String(e.after_json))]);
}

describe('audited additions under a race', () => {
  it('a role grant racing a concurrent revocation rolls back or records the state it replaced', async () => {
    const admin = await adminScope();
    const person = await addPerson([ACCOUNTING]);
    const db = racingRead(env.DB, HEAD, () => setGrants(admin, env.DB, person.id, [], T0), 1);
    await setGrants(admin, db, person.id, [ACCOUNTING, ADMIN], T0);
    expect((await grantsOf(env.DB, person.id)).toSorted()).toEqual([ACCOUNTING, ADMIN].toSorted());
    const events = await history('people.setRoles', `person:${person.id}`);
    expect(events.map(([before]) => before)).toEqual([{ roles: [ACCOUNTING] }, { roles: [] }]);
    expect(events[1]?.[0]).toEqual(events[0]?.[1]);
  });

  it('a task list change racing a concurrent removal rolls back or records the list it replaced', async () => {
    const admin = await adminScope();
    const { project } = await clientWithProject(admin);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const code = unique('R').replace(/\W/g, '');
      ids.push((await createTaskCode(admin, env.DB, { code, name: `Task ${code}` }, T0)).id);
    }
    const [a = '', b = '', c = ''] = ids;
    await setProjectTasks(admin, env.DB, project.id, [a, b], T0);
    const race = () => setProjectTasks(admin, env.DB, project.id, [b], T0);
    const db = racingRead(env.DB, HEAD, race, 1);
    await setProjectTasks(admin, db, project.id, [a, b, c], T0);
    const live = (await allowedTasks(admin, env.DB, project.id)).map((t) => t.task_code_id);
    expect(live.toSorted()).toEqual([a, b, c].toSorted());
    const events = await history('projects.setTasks', `project:${project.id}`);
    expect(events).toHaveLength(3);
    for (let i = 1; i < events.length; i++) expect(events[i]?.[0]).toEqual(events[i - 1]?.[1]);
  });
});
