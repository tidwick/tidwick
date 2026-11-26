// Week-grid fixtures: a signed-in member assigned to a project with allowed tasks, made through the real writes.
import { env } from 'cloudflare:workers';
import { addAssignment } from '../../src/db/assignments';
import { createClient } from '../../src/db/clients';
import { saveCells } from '../../src/db/entry-writes';
import { setProjectTasks } from '../../src/db/project-tasks';
import { createProject } from '../../src/db/projects';
import { createTaskCode } from '../../src/db/task-codes';
import type { Scope } from '../../src/db/scope';
import { addRow as addWeekRow } from '../../src/db/week-rows';
import { loadWeek } from '../../src/db/week-view';
import { scopeFor } from '../../src/db/scope';
import { currentEnv, noteKeks } from '../../src/lib/env';
import type { LoadedWeek } from '../../src/lib/week';
import { adminScope, T0 } from './auth';
import { caller, rpcForm, type Caller, type Fields } from './callers';
import { unique } from './reference';

let serial = 0;

export interface Task {
  id: string;
  code: string;
}

export interface Booking {
  who: Caller;
  admin: Scope;
  clientId: string;
  projectId: string;
  tasks: Task[];
}

/** A client with a project allowing `taskCount` tasks; `assigned` decides whether `who` is assigned to it. */
export async function project(
  admin: Scope,
  who: Caller,
  taskCount: number,
  assigned = true,
): Promise<Omit<Booking, 'who' | 'admin'>> {
  const now = T0;
  const client = await createClient(admin, env.DB, currentEnv().NOTE_KEK, unique('Client'), now);
  const made = await createProject(
    admin,
    env.DB,
    client.id,
    { name: unique('Project'), number: '' },
    now,
  );
  const tasks: Task[] = [];
  for (let n = 0; n < taskCount; n++) {
    serial += 1;
    const code = `T${String(serial).padStart(5, '0')}`;
    const row = await createTaskCode(admin, env.DB, { code, name: `Task ${code}` }, now);
    tasks.push({ id: row.id, code });
  }
  await setProjectTasks(
    admin,
    env.DB,
    made.id,
    tasks.map((t) => t.id),
    now,
  );
  if (assigned) await addAssignment(admin, env.DB, made.id, who.personId, now);
  return { clientId: client.id, projectId: made.id, tasks };
}

/** A new member assigned to one project with two allowed tasks. */
export async function booking(): Promise<Booking> {
  const admin = await adminScope();
  const who = await caller();
  return { who, admin, ...(await project(admin, who, 2)) };
}

/** The member's own week as the grid would show it. */
export async function weekOf(who: Caller, weekStart: string): Promise<LoadedWeek> {
  const scope = await scopeFor(env.DB, who.personId);
  return loadWeek(scope, env.DB, noteKeks(), who.personId, weekStart);
}

/** The cell fields for one cell, as the no-script form and the island post them. */
export function cell(rowId: string, dow: number, hours: string, note = ''): Fields {
  return {
    [`cell.${rowId}.${String(dow)}.hours`]: hours,
    [`cell.${rowId}.${String(dow)}.note`]: note,
  };
}

export async function save(who: Caller, weekStart: string, ...cells: Fields[]): Promise<Response> {
  return rpcForm('entries.save', who, Object.assign({ weekStart }, ...cells) as Fields);
}

/** Adds a row through the Action and returns its id, read back from the week. */
export async function addRow(
  who: Caller,
  weekStart: string,
  projectId: string,
  task: Task,
): Promise<string> {
  const response = await rpcForm('entries.addRow', who, {
    weekStart,
    projectId,
    taskCodeId: task.id,
  });
  if (response.status !== 200)
    throw new Error(`addRow ${String(response.status)}: ${await response.text()}`);
  const row = (await weekOf(who, weekStart)).rows.find(
    (r) => r.projectId === projectId && r.taskCode === task.code,
  );
  if (!row) throw new Error('the added row is not in the week');
  return row.rowId;
}

export const WEEK = '2026-01-05';
export const NEXT = '2026-01-12';

/** Adds the booking's two tasks as two rows of the week and returns their ids. */
export async function twoRows(b: Booking, week = WEEK): Promise<[string, string]> {
  const [first, second] = b.tasks;
  if (!first || !second) throw new Error('the booking needs two tasks');
  return [
    await addRow(b.who, week, b.projectId, first),
    await addRow(b.who, week, b.projectId, second),
  ];
}

/** The member's stored hours by row and day. */
export async function hoursOf(b: Booking, week: string): Promise<number[][]> {
  return (await weekOf(b.who, week)).rows.map((r) => r.cells.map((c) => c.hundredths));
}

/** The message an Action refusal carries. */
export async function messageOf(response: Response): Promise<string> {
  const body = await response.json<{ message?: string }>();
  return body.message ?? '';
}

/** A member's week written through the data layer, not the Worker: one row with four hours on Monday. */
export async function bookedWeek(): Promise<Booking & { member: Scope; rowId: string }> {
  const b = await booking();
  const member = await scopeFor(env.DB, b.who.personId);
  const task = b.tasks[0] ?? { id: '', code: '' };
  await addWeekRow(member, env.DB, WEEK, b.projectId, task.id);
  const rowId = (await weekOf(b.who, WEEK)).rows[0]?.rowId ?? '';
  const edit = { rowId, dow: 0, hundredths: 400, note: '' };
  await saveCells(member, env.DB, noteKeks(), WEEK, [edit], T0);
  return { ...b, member, rowId };
}
