// The week grid's Actions through the built Worker by the script caller: the rules the island and the no-script
// form both rely on are enforced on the server, so a client that skips its own checks changes nothing.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { adminScope } from '../../test/helpers/auth';
import { addRow, booking, project, twoRows, weekOf, WEEK, NEXT } from '../../test/helpers/booking';
import { caller, rpcForm } from '../../test/helpers/callers';
import { removeAssignment } from '../db/assignments';
import { scopeFor } from '../db/scope';
import { loadWeek } from '../db/week-view';
import { noteKeks } from '../lib/env';

describe('entries.addRow and copyLastWeek', () => {
  it('add row picks an assigned project and one of its allowed tasks, and the same pick twice leaves one row', async () => {
    const b = await booking();
    const [first] = b.tasks;
    await addRow(b.who, WEEK, b.projectId, first ?? { id: '', code: '' });
    await addRow(b.who, WEEK, b.projectId, first ?? { id: '', code: '' });
    const rows = (await weekOf(b.who, WEEK)).rows;
    expect(rows.map((r) => r.taskCode)).toEqual([first?.code]);
    expect(rows[0]?.cells).toHaveLength(7);
  });

  it('a task that is not allowed on the project is refused', async () => {
    const b = await booking();
    const other = await project(b.admin, b.who, 1, false);
    const response = await rpcForm('entries.addRow', b.who, {
      weekStart: WEEK,
      projectId: b.projectId,
      taskCodeId: other.tasks[0]?.id ?? '',
    });
    expect(response.status).toBe(400);
    expect((await weekOf(b.who, WEEK)).rows).toEqual([]);
  });

  it('copy last week skips rows already present, tasks no longer allowed and projects no longer assigned', async () => {
    const b = await booking();
    const gone = await project(b.admin, b.who, 1);
    const [a, c] = await twoRows(b, WEEK);
    await addRow(b.who, WEEK, gone.projectId, gone.tasks[0] ?? { id: '', code: '' });
    expect(a).toBeTruthy();
    await addRow(b.who, NEXT, b.projectId, b.tasks[0] ?? { id: '', code: '' });
    await removeAssignment(b.admin, env.DB, gone.projectId, b.who.personId, 1);
    expect((await rpcForm('entries.copyLastWeek', b.who, { weekStart: NEXT })).status).toBe(200);
    const rows = (await weekOf(b.who, NEXT)).rows;
    expect(rows.map((r) => r.taskCode)).toEqual(b.tasks.map((t) => t.code));
    expect(c).toBeTruthy();
    expect((await rpcForm('entries.copyLastWeek', b.who, { weekStart: NEXT })).status).toBe(200);
    expect((await weekOf(b.who, NEXT)).rows).toHaveLength(2);
  });
});

describe('SEC-20 a member reads only their own week and assigned projects', () => {
  it("SEC-20 another person's week is not found for a member and readable by an all-clients scope", async () => {
    const mine = await booking();
    const theirs = await booking();
    await twoRows(theirs);
    const own = await scopeFor(env.DB, mine.who.personId);
    await expect(
      loadWeek(own, env.DB, noteKeks(), theirs.who.personId, WEEK),
    ).rejects.toMatchObject({ code: 'not_found' });
    const admin = await adminScope();
    expect(
      (await loadWeek(admin, env.DB, noteKeks(), theirs.who.personId, WEEK)).rows,
    ).toHaveLength(2);
  });

  it('SEC-20 a row on a project that is no longer assigned is left out of the member’s week', async () => {
    const b = await booking();
    await twoRows(b);
    expect((await weekOf(b.who, WEEK)).rows).toHaveLength(2);
    await removeAssignment(b.admin, env.DB, b.projectId, b.who.personId, 1);
    expect((await weekOf(b.who, WEEK)).rows).toEqual([]);
    const stranger = await caller();
    expect((await weekOf(stranger, WEEK)).rows).toEqual([]);
  });
});
