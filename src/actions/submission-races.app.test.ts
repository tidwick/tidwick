// SEC-13 negative cases under concurrency: a decision or an edit through the lock that loses a race writes no
// audit event, and the one that lands carries the values it actually replaced.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ACCOUNTING, T0 } from '../../test/helpers/auth';
import { booking, cell, save, twoRows, weekOf, WEEK } from '../../test/helpers/booking';
import { caller, rpcForm } from '../../test/helpers/callers';
import { eventsAfter, headSeq } from '../../test/helpers/reference';
import { saveCellsFor } from '../db/entries-for';
import { entriesOfWeek } from '../db/entries';
import { scopeFor } from '../db/scope';
import { racingDb } from '../db/test-support';
import { noteKeks } from '../lib/env';
import { isAppError } from '../lib/errors';

async function lockedWeek() {
  const b = await booking();
  const [row] = await twoRows(b);
  expect((await save(b.who, WEEK, cell(row, 0, '4'))).status).toBe(200);
  expect((await rpcForm('submission.submit', b.who, { weekStart: WEEK })).status).toBe(200);
  const admin = await caller([ACCOUNTING]);
  const scope = await scopeFor(env.DB, admin.personId);
  const [entry] = await entriesOfWeek(scope, env.DB, b.who.personId, WEEK);
  if (!entry) throw new Error('the week has no entry');
  return { b, row, admin, scope, entryId: entry.id };
}

/** Another writer adding an hour to the entry, as a second admin's save landing first would. */
const bump = (entryId: string) => () =>
  env.DB.exec(`UPDATE entry SET hundredths = hundredths + 100 WHERE id = '${entryId}'`);

describe('SEC-13 races on a locked week', () => {
  it('SEC-13 two accounting admins approving one week: one lands, the other is refused, one event', async () => {
    const { b } = await lockedWeek();
    const [first, second] = [await caller([ACCOUNTING]), await caller([ACCOUNTING])];
    const seq = await headSeq();
    const fields = { personId: b.who.personId, weekStart: WEEK };
    const answers = await Promise.all([
      rpcForm('submission.approve', first, fields),
      rpcForm('submission.approve', second, fields),
    ]);
    expect(answers.map((r) => r.status).toSorted()).toEqual([200, 409]);
    const events = await eventsAfter(seq);
    expect(events.map((e) => e.action)).toEqual(['submission.approve']);
    expect((await weekOf(b.who, WEEK)).state).toBe('approved');
  });

  it('SEC-13 a submit racing an approve: every event written matches a change that landed', async () => {
    const b = await booking();
    const admin = await caller([ACCOUNTING]);
    const seq = await headSeq();
    const fields = { personId: b.who.personId, weekStart: WEEK };
    const [submitted, approved] = await Promise.all([
      rpcForm('submission.submit', b.who, { weekStart: WEEK }),
      rpcForm('submission.approve', admin, fields),
    ]);
    expect(submitted.status).toBe(200);
    const actions = (await eventsAfter(seq)).map((e) => e.action);
    const state = (await weekOf(b.who, WEEK)).state;
    if (approved.status === 200) {
      expect(actions).toEqual(['submission.submit', 'submission.approve']);
      expect(state).toBe('approved');
    } else {
      expect(approved.status).toBe(409);
      expect(actions).toEqual(['submission.submit']);
      expect(state).toBe('submitted');
    }
  });

  it('SEC-13 an edit through the lock racing a concurrent edit retries and records the value it replaced', async () => {
    const { b, row, scope, entryId } = await lockedWeek();
    const seq = await headSeq();
    const edits = [{ rowId: row, dow: 0, hundredths: 800, note: '' }];
    const db = racingDb(env.DB, bump(entryId), 1);
    await saveCellsFor(scope, db, noteKeks(), b.who.personId, WEEK, edits, T0);
    const events = await eventsAfter(seq);
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]?.before_json ?? 'null')).toMatchObject({
      hundredths: 500,
      note_ct: null,
    });
    expect(JSON.parse(events[0]?.after_json ?? 'null')).toMatchObject({
      hundredths: 800,
      note_ct: null,
    });
  });

  it('SEC-13 an edit through the lock that loses every race is a conflict and writes no event', async () => {
    const { b, row, scope, entryId } = await lockedWeek();
    const seq = await headSeq();
    const edits = [{ rowId: row, dow: 0, hundredths: 800, note: '' }];
    const db = racingDb(env.DB, bump(entryId), 2);
    const outcome = await saveCellsFor(
      scope,
      db,
      noteKeks(),
      b.who.personId,
      WEEK,
      edits,
      T0,
    ).catch((error: unknown) => error);
    expect(isAppError(outcome, 'conflict')).toBe(true);
    expect(await eventsAfter(seq)).toEqual([]);
    expect((await weekOf(b.who, WEEK)).rows[0]?.cells[0]?.hundredths).toBe(600);
  });
});
