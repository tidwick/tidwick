// submit_week through the built Worker: it asks twice, and a week that changed between the two answers refuses.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { cells, setup, tool } from '../../test/helpers/agent';
import { T0 } from '../../test/helpers/auth';
import { WEEK, weekOf } from '../../test/helpers/booking';
import { eventsAfter, headSeq } from '../../test/helpers/reference';
import { saveCells } from '../db/entry-writes';
import { scopeFor } from '../db/scope';
import { noteKeks } from '../lib/env';

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
