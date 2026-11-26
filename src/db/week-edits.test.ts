// The before and after of cells an accounting admin edited through the lock, read back for the approvals page.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { T0 } from '../../test/helpers/auth';
import { bookedWeek, WEEK } from '../../test/helpers/booking';
import { noteKeks } from '../lib/env';
import { saveCellsFor } from './entries-for';
import { editsOfWeek } from './week-edits';

const keks = () => noteKeks();

describe('the edits made to a week through the lock', () => {
  it('lists an edited cell with its project, task, day, the editor, and the hours before and after', async () => {
    const w = await bookedWeek();
    const person = w.who.personId;
    await saveCellsFor(
      w.admin,
      env.DB,
      keks(),
      person,
      WEEK,
      [{ rowId: w.rowId, dow: 0, hundredths: 550, note: '' }],
      T0 + 1000,
    );
    const [edit, ...rest] = await editsOfWeek(w.admin, env.DB, person, WEEK);
    expect(rest).toEqual([]);
    expect(edit).toMatchObject({
      at: T0 + 1000,
      dow: 0,
      task: w.tasks[0]?.code,
      before: 400,
      after: 550,
      noteChanged: false,
    });
    expect(edit?.editor).not.toBeNull();
  });

  it('a cell cleared through the lock is listed with no hours after, and its event names the row and day', async () => {
    const w = await bookedWeek();
    const person = w.who.personId;
    await saveCellsFor(
      w.admin,
      env.DB,
      keks(),
      person,
      WEEK,
      [{ rowId: w.rowId, dow: 0, hundredths: 0, note: '' }],
      T0 + 5,
    );
    const edits = await editsOfWeek(w.admin, env.DB, person, WEEK);
    expect(edits.map((e) => [e.dow, e.before, e.after])).toEqual([[0, 400, null]]);
    const event = await env.DB.prepare(
      "SELECT before_json, after_json FROM audit_event WHERE action = 'entriesFor.save' AND json_extract(coalesce(after_json, before_json), '$.row') = ?1",
    )
      .bind(w.rowId)
      .first<{ before_json: string; after_json: string | null }>();
    expect(event?.after_json).toBeNull();
    expect(JSON.parse(event?.before_json ?? '{}')).toMatchObject({ row: w.rowId, dow: 0 });
  });

  it('a note-only change shows the hours unchanged and says the note changed, never what it said', async () => {
    const w = await bookedWeek();
    const person = w.who.personId;
    await saveCellsFor(
      w.admin,
      env.DB,
      keks(),
      person,
      WEEK,
      [{ rowId: w.rowId, dow: 0, hundredths: 400, note: 'secret words' }],
      T0,
    );
    const edits = await editsOfWeek(w.admin, env.DB, person, WEEK);
    expect(edits.map((e) => [e.before, e.after, e.noteChanged])).toEqual([[400, 400, true]]);
    expect(JSON.stringify(edits)).not.toContain('secret words');
  });

  it('two edits to one cell come back oldest first, each against the value it replaced', async () => {
    const w = await bookedWeek();
    const person = w.who.personId;
    const save = (hundredths: number, at: number) =>
      saveCellsFor(
        w.admin,
        env.DB,
        keks(),
        person,
        WEEK,
        [{ rowId: w.rowId, dow: 0, hundredths, note: '' }],
        at,
      );
    await save(500, T0 + 1);
    await save(700, T0 + 2);
    const edits = await editsOfWeek(w.admin, env.DB, person, WEEK);
    expect(edits.map((e) => [e.before, e.after])).toEqual([
      [400, 500],
      [500, 700],
    ]);
  });

  it('another person’s edits and an unedited week are not listed, and a member is refused', async () => {
    const mine = await bookedWeek();
    const other = await bookedWeek();
    await saveCellsFor(
      other.admin,
      env.DB,
      keks(),
      other.who.personId,
      WEEK,
      [{ rowId: other.rowId, dow: 0, hundredths: 900, note: '' }],
      T0,
    );
    expect(await editsOfWeek(mine.admin, env.DB, mine.who.personId, WEEK)).toEqual([]);
    await expect(editsOfWeek(mine.member, env.DB, mine.who.personId, WEEK)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
