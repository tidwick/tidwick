// The seven tools through the built Worker, as an agent holding a token: what each does to a person's own week,
// what it refuses, and what an agent's write leaves in the audit log.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { mintAgent, tool, type Agent } from '../../test/helpers/agent';
import { adminScope, T0 } from '../../test/helpers/auth';
import { booking, project, WEEK, weekOf, type Booking } from '../../test/helpers/booking';
import { caller } from '../../test/helpers/callers';
import { eventsAfter, headSeq } from '../../test/helpers/reference';
import { decideWeek } from '../db/submissions';
import { saveCells } from '../db/entry-writes';
import { scopeFor } from '../db/scope';
import { noteKeks } from '../lib/env';

interface Setup {
  b: Booking;
  agent: Agent;
  rowId: string;
}

async function setup(): Promise<Setup> {
  const b = await booking();
  const agent = await mintAgent(b.who.personId);
  const task = b.tasks[0];
  const added = await tool(agent, 'add_row', {
    weekStart: WEEK,
    projectId: b.projectId,
    taskCodeId: task?.id,
  });
  const rows = added.data.rows as { rowId: string }[];
  return { b, agent, rowId: rows[0]?.rowId ?? '' };
}

const cells = (rowId: string, ...days: [number, number | string, string?][]) =>
  days.map(([day, hours, note]) => ({
    rowId,
    day,
    hours,
    ...(note === undefined ? {} : { note }),
  }));

describe('reading', () => {
  it('list_projects names the assigned projects with their tasks, and no other', async () => {
    const { b, agent } = await setup();
    await project(await adminScope(), await caller(), 1);
    const listed = await tool(agent, 'list_projects');
    const projects = listed.data.projects as { projectId: string; tasks: unknown[] }[];
    expect(projects.map((p) => p.projectId)).toEqual([b.projectId]);
    expect(projects[0]?.tasks).toHaveLength(2);
  });

  it('get_week returns only cells that hold something, with has_note and never a note, since notes are off', async () => {
    const { b, agent, rowId } = await setup();
    const member = await scopeFor(env.DB, b.who.personId);
    await saveCells(
      member,
      env.DB,
      noteKeks(),
      WEEK,
      [{ rowId, dow: 1, hundredths: 250, note: 'confidential detail' }],
      T0,
    );
    const week = await tool(agent, 'get_week', { weekStart: WEEK });
    expect(week.data).toMatchObject({
      weekStart: WEEK,
      state: 'draft',
      rows: [{ rowId, cells: [{ day: 1, hundredths: 250, has_note: true }] }],
    });
    expect(week.text).not.toContain('confidential');
  });

  it('a bad week start is refused as input, not as a protocol error', async () => {
    const { agent } = await setup();
    const bad = await tool(agent, 'get_week', { weekStart: '2026-01-06' });
    expect(bad).toMatchObject({ status: 200, isError: true, data: { error: 'invalid_input' } });
    expect((await tool(agent, 'get_week', {})).isError).toBe(true);
  });
});

describe('save_entries', () => {
  it('writes the cells, leaves one entries.save event marked via with no note text, and a person’s own save leaves none', async () => {
    const { b, agent, rowId } = await setup();
    const seq = await headSeq();
    const saved = await tool(agent, 'save_entries', {
      weekStart: WEEK,
      cells: cells(rowId, [0, 7.5, 'worked on the thing'], [2, '4']),
    });
    expect(saved.isError).toBe(false);
    const [row] = (await weekOf(b.who, WEEK)).rows;
    expect(row?.cells[0]).toEqual({ hundredths: 750, note: 'worked on the thing' });
    expect(row?.cells[2]).toEqual({ hundredths: 400, note: '' });
    const events = await eventsAfter(seq);
    expect(events.map((e) => e.action)).toEqual(['entries.save']);
    expect(events[0]?.actor_id).toBe(b.who.personId);
    expect(events[0]?.after_json).toContain(`"via":{"kind":"agent","grant":"${agent.grantId}"`);
    expect(JSON.stringify(events)).not.toContain('worked on');
    const human = await headSeq();
    const member = await scopeFor(env.DB, b.who.personId);
    await saveCells(
      member,
      env.DB,
      noteKeks(),
      WEEK,
      [{ rowId, dow: 3, hundredths: 100, note: '' }],
      T0,
    );
    expect(await eventsAfter(human)).toEqual([]);
  });

  it('a cell with no note keeps the stored one, and an empty note clears it', async () => {
    const { b, agent, rowId } = await setup();
    await tool(agent, 'save_entries', {
      weekStart: WEEK,
      cells: cells(rowId, [0, 2, 'keep me'], [1, 2, 'drop me']),
    });
    await tool(agent, 'save_entries', {
      weekStart: WEEK,
      cells: cells(rowId, [0, 3], [1, 3, '']),
    });
    const [row] = (await weekOf(b.who, WEEK)).rows;
    expect(row?.cells[0]).toEqual({ hundredths: 300, note: 'keep me' });
    expect(row?.cells[1]).toEqual({ hundredths: 300, note: '' });
  });

  it('refuses a day over 24 hours, a bad number, another person’s row and a locked week, writing nothing', async () => {
    const { b, agent, rowId } = await setup();
    const other = await setup();
    const day = await tool(agent, 'save_entries', {
      weekStart: WEEK,
      cells: cells(rowId, [0, 25]),
    });
    expect(day).toMatchObject({ isError: true, data: { error: 'invalid_input' } });
    expect(
      (await tool(agent, 'save_entries', { weekStart: WEEK, cells: cells(rowId, [0, 'x1']) }))
        .isError,
    ).toBe(true);
    const mine = await tool(agent, 'save_entries', {
      weekStart: WEEK,
      cells: cells(other.rowId, [0, 1]),
    });
    expect(mine).toMatchObject({ isError: true, data: { error: 'forbidden' } });
    const seq = await headSeq();
    await tool(agent, 'save_entries', { weekStart: WEEK, cells: cells(rowId, [0, 8]) });
    await tool(agent, 'save_entries', { weekStart: WEEK, cells: cells(rowId, [1, 20]) });
    expect(await eventsAfter(seq)).toHaveLength(2);
    const over = await tool(agent, 'save_entries', {
      weekStart: WEEK,
      cells: cells(rowId, [0, 24], [1, 24.5]),
    });
    expect(over.isError).toBe(true);
    expect((await weekOf(b.who, WEEK)).rows[0]?.cells[0]?.hundredths).toBe(800);
  });

  it('refuses a submitted and an approved week', async () => {
    const { b, agent, rowId } = await setup();
    await tool(agent, 'save_entries', { weekStart: WEEK, cells: cells(rowId, [0, 8]) });
    const first = await tool(agent, 'submit_week', { weekStart: WEEK });
    await tool(agent, 'submit_week', { weekStart: WEEK, confirm: first.data.confirm });
    const submitted = await tool(agent, 'save_entries', {
      weekStart: WEEK,
      cells: cells(rowId, [0, 1]),
    });
    expect(submitted).toMatchObject({ isError: true, data: { error: 'locked' } });
    await decideWeek(await adminScope(), env.DB, b.who.personId, WEEK, 'approve', T0);
    const approved = await tool(agent, 'save_entries', {
      weekStart: WEEK,
      cells: cells(rowId, [0, 1]),
    });
    expect(approved).toMatchObject({ isError: true, data: { error: 'locked' } });
    expect((await tool(agent, 'submit_week', { weekStart: WEEK })).data.error).toBe('locked');
  });
});

describe('rows', () => {
  it('add_row refuses an unassigned project, remove_row a row holding hours, and copy_last_week copies rows only', async () => {
    const { b, agent, rowId } = await setup();
    const elsewhere = await project(await adminScope(), await caller(), 1, false);
    const refused = await tool(agent, 'add_row', {
      weekStart: WEEK,
      projectId: elsewhere.projectId,
      taskCodeId: elsewhere.tasks[0]?.id,
    });
    expect(refused).toMatchObject({ isError: true, data: { error: 'forbidden' } });
    await tool(agent, 'save_entries', { weekStart: WEEK, cells: cells(rowId, [0, 1, 'n']) });
    const kept = await tool(agent, 'remove_row', { weekStart: WEEK, rowId });
    expect(kept).toMatchObject({ isError: true, data: { error: 'row_not_empty' } });
    const next = '2026-01-12';
    const copied = await tool(agent, 'copy_last_week', { weekStart: next });
    expect(copied.data).toMatchObject({ rows: [{ cells: [] }] });
    const rowsNow = (await weekOf(b.who, next)).rows;
    expect(rowsNow).toHaveLength(1);
    const removed = await tool(agent, 'remove_row', { weekStart: next, rowId: rowsNow[0]?.rowId });
    expect(removed.data.rows).toEqual([]);
  });

  it('an agent only ever sees its own person’s week', async () => {
    const mine = await setup();
    const theirs = await setup();
    await tool(theirs.agent, 'save_entries', {
      weekStart: WEEK,
      cells: cells(theirs.rowId, [0, 9]),
    });
    const week = await tool(mine.agent, 'get_week', { weekStart: WEEK });
    expect(JSON.stringify(week.data)).not.toContain(theirs.rowId);
    const poke = await tool(mine.agent, 'remove_row', { weekStart: WEEK, rowId: theirs.rowId });
    expect(poke).toMatchObject({ isError: true, data: { error: 'forbidden' } });
  });
});

describe('submit_week asks twice', () => {
  it('the first call summarises and changes nothing; the second submits, marked via', async () => {
    const { b, agent, rowId } = await setup();
    await tool(agent, 'save_entries', { weekStart: WEEK, cells: cells(rowId, [0, 8], [1, 4]) });
    const seq = await headSeq();
    const first = await tool(agent, 'submit_week', { weekStart: WEEK });
    expect(first.data).toMatchObject({
      submitted: false,
      state: 'draft',
      summary: { rows: 1, totalHundredths: 1200, dayHundredths: [800, 400, 0, 0, 0, 0, 0] },
    });
    expect(typeof first.data.confirm).toBe('string');
    expect(await eventsAfter(seq)).toEqual([]);
    const done = await tool(agent, 'submit_week', { weekStart: WEEK, confirm: first.data.confirm });
    expect(done.data).toMatchObject({ submitted: true, state: 'submitted' });
    const [event] = await eventsAfter(seq);
    expect(event?.action).toBe('submission.submit');
    expect(event?.after_json).toContain('"via":{"kind":"agent"');
    expect((await weekOf(b.who, WEEK)).state).toBe('submitted');
  });

  it('a confirm made before a cell edit refuses, and so does a confirm for another week, person or form', async () => {
    const { b, agent, rowId } = await setup();
    await tool(agent, 'save_entries', { weekStart: WEEK, cells: cells(rowId, [0, 8]) });
    const first = await tool(agent, 'submit_week', { weekStart: WEEK });
    const member = await scopeFor(env.DB, b.who.personId);
    await saveCells(
      member,
      env.DB,
      noteKeks(),
      WEEK,
      [{ rowId, dow: 0, hundredths: 100, note: '' }],
      T0,
    );
    const stale = await tool(agent, 'submit_week', {
      weekStart: WEEK,
      confirm: first.data.confirm,
    });
    expect(stale).toMatchObject({ isError: true, data: { error: 'conflict' } });
    expect((await weekOf(b.who, WEEK)).state).toBe('draft');
    const fresh = await tool(agent, 'submit_week', { weekStart: WEEK });
    const forWeek = await tool(agent, 'submit_week', {
      weekStart: '2026-01-12',
      confirm: fresh.data.confirm,
    });
    expect(forWeek).toMatchObject({ isError: true, data: { error: 'invalid_input' } });
    const stranger = await setup();
    const theirs = await tool(stranger.agent, 'submit_week', {
      weekStart: WEEK,
      confirm: fresh.data.confirm,
    });
    expect(theirs).toMatchObject({ isError: true, data: { error: 'invalid_input' } });
    const forged = String(fresh.data.confirm).replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
    for (const confirm of [forged, 'x', '1.2.3.4.5.6', '']) {
      const bad = await tool(agent, 'submit_week', { weekStart: WEEK, confirm });
      expect(bad, confirm).toMatchObject({ isError: true });
    }
    expect((await weekOf(b.who, WEEK)).state).toBe('draft');
  });
});
