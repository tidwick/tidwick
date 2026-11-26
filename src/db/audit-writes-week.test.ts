// One audit event per submission transition and per cell edited through the lock, with actor, target and the
// values before and after; the cases audit.test.ts requires for the `submission` and `entriesFor` Actions.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { T0 } from '../../test/helpers/auth';
import { bookedWeek, WEEK } from '../../test/helpers/booking';
import { eventsAfter, headSeq } from '../../test/helpers/reference';
import { noteKeks } from '../lib/env';
import { saveCellsFor } from './entries-for';
import type { Scope } from './scope';
import { decideWeek, submitWeek } from './submissions';

interface Case {
  action: string;
  actor: Scope;
  run: () => Promise<unknown>;
  target: RegExp;
  before: object | null;
  after: object;
}

describe('every week write outside the owner’s own edits is audited once', () => {
  it('submit, an edit through the lock, approve and return each add one event of their own name', async () => {
    const w = await bookedWeek();
    const person = w.who.personId;
    const keks = noteKeks();
    const edit = { rowId: w.rowId, dow: 0, hundredths: 550, note: '' };
    const cases: Case[] = [
      {
        action: 'submission.submit',
        actor: w.member,
        run: () => submitWeek(w.member, env.DB, WEEK, T0),
        target: new RegExp(`^week:${person}:${WEEK}$`),
        before: { state: 'draft' },
        after: { state: 'submitted' },
      },
      {
        action: 'entriesFor.save',
        actor: w.admin,
        run: () => saveCellsFor(w.admin, env.DB, keks, person, WEEK, [edit], T0),
        target: /^entry:/,
        before: { hundredths: 400, note_ct: null, row: w.rowId, dow: 0 },
        after: { hundredths: 550, note_ct: null, row: w.rowId, dow: 0 },
      },
      {
        action: 'submission.approve',
        actor: w.admin,
        run: () => decideWeek(w.admin, env.DB, person, WEEK, 'approve', T0),
        target: /^week:/,
        before: { state: 'submitted' },
        after: { state: 'approved' },
      },
      {
        action: 'submission.return',
        actor: w.admin,
        run: () => decideWeek(w.admin, env.DB, person, WEEK, 'return', T0),
        target: /^week:/,
        before: { state: 'approved' },
        after: { state: 'returned' },
      },
    ];
    for (const c of cases) {
      const seq = await headSeq();
      await c.run();
      const events = await eventsAfter(seq);
      expect(
        events.map((e) => e.action),
        c.action,
      ).toEqual([c.action]);
      const [event] = events;
      expect(event?.actor_id, c.action).toBe(c.actor.actorId);
      expect(event?.target, c.action).toMatch(c.target);
      expect(JSON.parse(event?.before_json ?? 'null'), c.action).toEqual(c.before);
      expect(JSON.parse(event?.after_json ?? 'null'), c.action).toEqual(c.after);
    }
  });

  it('a transition the table refuses and a member edit through the lock leave no event', async () => {
    const w = await bookedWeek();
    const seq = await headSeq();
    const person = w.who.personId;
    await expect(decideWeek(w.admin, env.DB, person, WEEK, 'approve', T0)).rejects.toMatchObject({
      code: 'bad_transition',
    });
    await expect(
      saveCellsFor(w.member, env.DB, noteKeks(), person, WEEK, [], T0),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(decideWeek(w.member, env.DB, person, WEEK, 'approve', T0)).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(await eventsAfter(seq)).toEqual([]);
  });
});
