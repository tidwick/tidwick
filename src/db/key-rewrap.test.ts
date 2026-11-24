// SEC-32: rotating NOTE_KEK. Notes read the same before, during and after; a run that stops partway resumes; every
// key moved is one audit event that names the KEKs, never the key; and a rewrap that cannot be right writes nothing.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { adminScope, T0 } from '../../test/helpers/auth';
import { booking, WEEK } from '../../test/helpers/booking';
import { eventsAfter, headSeq, memberScope, unique } from '../../test/helpers/reference';
import { currentEnv } from '../lib/env';
import { isAppError } from '../lib/errors';
import { D1_QUERIES_PER_INVOCATION } from '../lib/limits';
import { kekId, newClientKey, type NoteKeks } from '../lib/note-crypto';
import { checkChain } from './audit';
import { keyRing } from './client-keys';
import { createClient } from './clients';
import { saveCells } from './entry-writes';
import { keyStatus, REWRAP_PAGE, REWRAP_PAGES, rewrapKeys } from './key-rewrap';
import { scopeFor } from './scope';
import { countingDb, racingDb } from './test-support';
import { addRow } from './week-rows';
import { loadWeek } from './week-view';

/** The KEK every helper in this file wraps new keys under, as a deployment before its first rotation. */
const OLD = (): string => currentEnv().NOTE_KEK;
const freshKek = (): string =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const only = (current: string): NoteKeks => ({ current, previous: null });

/** A member's week with one note on Monday, on a client whose key is wrapped under the old KEK. */
async function notedWeek(text: string) {
  const b = await booking();
  const member = await scopeFor(env.DB, b.who.personId);
  const task = b.tasks[0] ?? { id: '' };
  await addRow(member, env.DB, WEEK, b.projectId, task.id);
  const rowId = (await loadWeek(member, env.DB, only(OLD()), b.who.personId, WEEK)).rows[0]?.rowId;
  const edit = { rowId: rowId ?? '', dow: 0, hundredths: 150, note: text };
  await saveCells(member, env.DB, only(OLD()), WEEK, [edit], T0);
  const noteUnder = async (keks: NoteKeks): Promise<string | undefined> =>
    (await loadWeek(member, env.DB, keks, b.who.personId, WEEK)).rows[0]?.cells[0]?.note;
  return { ...b, member, rowId: rowId ?? '', noteUnder };
}

/** Each client's data key as the ring opens it, so a test can show rewrap left the key itself unchanged. */
async function dataKeys(ids: readonly string[], keks: NoteKeks): Promise<string[]> {
  const ring = keyRing(env.DB, keks);
  return Promise.all(ids.map(async (id) => String((await ring.current(id))?.key)));
}

async function oldKeyedClients(count: number): Promise<string[]> {
  const admin = await adminScope();
  const ids: string[] = [];
  for (let n = 0; n < count; n++) {
    ids.push((await createClient(admin, env.DB, OLD(), unique('Rotated'), T0)).id);
  }
  return ids;
}

const KEY_ROW = 'SELECT kek_id FROM client_key WHERE client_id = ?1 AND version = 1';
const kekOf = async (clientId: string) =>
  (await env.DB.prepare(KEY_ROW).bind(clientId).first<{ kek_id: string }>())?.kek_id;

async function refusal(run: Promise<unknown>): Promise<string> {
  const error: unknown = await run.then(
    () => null,
    (e: unknown) => e,
  );
  return isAppError(error) ? `${error.code}${error.detail ? `: ${error.detail}` : ''}` : 'none';
}

describe('SEC-32 NOTE_KEK rotation', () => {
  it('SEC-32 a note reads the same before the rotation, while keys sit under both KEKs, and after', async () => {
    const one = await notedWeek('pour the slab');
    const two = await notedWeek('strip the forms');
    const NEW = freshKek();
    const during: NoteKeks = { current: NEW, previous: OLD() };
    for (const week of [one, two]) {
      expect(await week.noteUnder(only(OLD()))).toBe(
        week === one ? 'pour the slab' : 'strip the forms',
      );
      expect(await week.noteUnder(during)).toBe(week === one ? 'pour the slab' : 'strip the forms');
    }

    const admin = await adminScope();
    const first = await rewrapKeys(admin, env.DB, during, T0, { page: 1, pages: 1 });
    expect(first.rewrapped).toBe(1);
    expect(first.status.current).toBe(1);
    expect(first.status.previous).toBeGreaterThan(0);
    for (const week of [one, two]) {
      await saveCells(
        week.member,
        env.DB,
        during,
        WEEK,
        [{ rowId: week.rowId, dow: 1, hundredths: 50, note: 'mid' }],
        T0,
      );
      expect(
        (await loadWeek(week.member, env.DB, during, week.who.personId, WEEK)).rows[0]?.cells[1]
          ?.note,
      ).toBe('mid');
    }

    const rest = await rewrapKeys(admin, env.DB, during, T0);
    expect(rest.status.previous).toBe(0);
    expect(await one.noteUnder(only(NEW))).toBe('pour the slab');
    expect(await two.noteUnder(only(NEW))).toBe('strip the forms');
    expect(await kekOf(one.clientId)).toBe(await kekId(NEW));

    expect(await refusal(one.noteUnder(only(OLD())))).toBe('note_kek_missing');
    expect(
      await refusal(
        saveCells(
          two.member,
          env.DB,
          only(OLD()),
          WEEK,
          [{ rowId: two.rowId, dow: 2, hundredths: 10, note: 'x' }],
          T0,
        ),
      ),
    ).toBe('note_kek_missing');
  });

  it('SEC-32 a run that stops partway keeps the pages it finished and the next run does the rest, one event per key', async () => {
    const ids = await oldKeyedClients(5);
    const before = await dataKeys(ids, only(OLD()));
    const NEW = freshKek();
    const keks: NoteKeks = { current: NEW, previous: OLD() };
    const admin = await adminScope();
    const head = await headSeq();
    const waiting = (await keyStatus(env.DB, keks)).previous;
    expect(waiting).toBeGreaterThanOrEqual(5);

    let batches = 0;
    const dying = racingDb(
      env.DB,
      () => (++batches > 1 ? Promise.reject(new Error('isolate ended')) : Promise.resolve()),
      2,
    );
    await expect(rewrapKeys(admin, dying, keks, T0, { page: 2, pages: 4 })).rejects.toThrow(
      'isolate ended',
    );
    const stopped = await keyStatus(env.DB, keks);
    expect([stopped.current, stopped.previous]).toEqual([2, waiting - 2]);
    expect(await dataKeys(ids, keks)).toEqual(before);

    const resumed = await rewrapKeys(admin, env.DB, keks, T0, { page: 2, pages: 4 });
    expect(resumed.rewrapped).toBe(waiting - 2);
    expect(resumed.status).toMatchObject({ current: waiting, previous: 0 });
    expect(await dataKeys(ids, only(NEW))).toEqual(before);

    const events = await eventsAfter(head);
    expect(events).toHaveLength(waiting);
    expect(new Set(events.map((e) => e.target)).size).toBe(waiting);
    expect(new Set(events.map((e) => `${e.action} ${String(e.actor_id)}`))).toEqual(
      new Set([`keys.rewrap ${String(admin.actorId)}`]),
    );
    expect((await checkChain(env.DB)).ok).toBe(true);
  });

  it('SEC-32 a key moved by a second admin between the read and the write rolls the page back, and the retry finds it done', async () => {
    await oldKeyedClients(3);
    const keks: NoteKeks = { current: freshKek(), previous: OLD() };
    const admin = await adminScope();
    const head = await headSeq();
    const waiting = (await keyStatus(env.DB, keks)).previous;
    const racing = racingDb(env.DB, () => rewrapKeys(admin, env.DB, keks, T0), 1);
    const late = await rewrapKeys(admin, racing, keks, T0);
    expect(late.rewrapped).toBe(0);
    expect(late.status).toMatchObject({ current: waiting, previous: 0 });
    expect(await eventsAfter(head)).toHaveLength(waiting);
  });

  it(`a run at its cap of ${String(REWRAP_PAGE * REWRAP_PAGES)} keys stays inside the query budget even if every page is retried, and the next run takes the rest`, async () => {
    const cap = REWRAP_PAGE * REWRAP_PAGES;
    const statements: D1PreparedStatement[] = [];
    for (let n = 0; n <= cap; n++) {
      const id = crypto.randomUUID();
      const key = await newClientKey(OLD(), id, 1);
      statements.push(
        env.DB.prepare('INSERT INTO client (id, name, created_at) VALUES (?1, ?2, ?3)').bind(
          id,
          `Budget ${id}`,
          T0,
        ),
        env.DB.prepare(
          'INSERT INTO client_key (client_id, version, wrapped, iv, kek_id, created_at) VALUES (?1, 1, ?2, ?3, ?4, ?5)',
        ).bind(id, key.wrapped, key.iv, key.kekId, T0),
      );
    }
    await env.DB.batch(statements);
    const keks: NoteKeks = { current: freshKek(), previous: OLD() };
    const waiting = (await keyStatus(env.DB, keks)).previous;
    const counted = countingDb(env.DB);
    const run = await rewrapKeys(await adminScope(), counted.db, keks, T0);
    expect(run.rewrapped).toBe(cap);
    expect(run.status.previous).toBe(waiting - cap);
    expect(2 * counted.count()).toBeLessThan(D1_QUERIES_PER_INVOCATION);
    expect((await rewrapKeys(await adminScope(), env.DB, keks, T0)).status.previous).toBe(0);
  });

  it('SEC-32 a rewrap with no NOTE_KEK_PREVIOUS, with the same key twice, or by a member is refused and writes nothing', async () => {
    await oldKeyedClients(1);
    const admin = await adminScope();
    const { scope: member } = await memberScope();
    const head = await headSeq();
    const status = await keyStatus(env.DB, only(OLD()));
    expect(await refusal(rewrapKeys(admin, env.DB, only(OLD()), T0))).toMatch(
      /^rewrap_refused: NOTE_KEK_PREVIOUS is not set/,
    );
    expect(
      await refusal(rewrapKeys(admin, env.DB, { current: OLD(), previous: OLD() }, T0)),
    ).toMatch(/^rewrap_refused: NOTE_KEK_PREVIOUS is the same key/);
    expect(
      await refusal(rewrapKeys(member, env.DB, { current: freshKek(), previous: OLD() }, T0)),
    ).toBe('forbidden');
    expect(await headSeq()).toBe(head);
    expect(await keyStatus(env.DB, only(OLD()))).toEqual(status);
  });

  it('SEC-32 a previous KEK that wrapped nothing moves nothing, and a key that will not open under the right one stops its page unwritten', async () => {
    const [bad = '', good = ''] = await oldKeyedClients(2);
    const admin = await adminScope();
    const head = await headSeq();
    const stranger = await rewrapKeys(
      admin,
      env.DB,
      { current: freshKek(), previous: freshKek() },
      T0,
    );
    expect([stranger.rewrapped, stranger.status.previous]).toEqual([0, 0]);
    expect(stranger.status.other).toBeGreaterThan(0);

    await env.DB.prepare('UPDATE client_key SET wrapped = zeroblob(48) WHERE client_id = ?1')
      .bind(bad)
      .run();
    const keks: NoteKeks = { current: freshKek(), previous: OLD() };
    const status = await keyStatus(env.DB, keks);
    expect(await refusal(rewrapKeys(admin, env.DB, keks, T0, { page: 500, pages: 1 }))).toBe(
      `rewrap_refused: the key of client ${bad} does not open under NOTE_KEK_PREVIOUS`,
    );
    expect(await keyStatus(env.DB, keks)).toEqual(status);
    expect(await kekOf(good)).toBe(await kekId(OLD()));
    expect(await headSeq()).toBe(head);
  });
});
