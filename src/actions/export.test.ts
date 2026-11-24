// SEC-24 through the built Worker: a file leaves only for an accounting admin with a fresh passkey confirmation,
// as an attachment that is never cached, and every export is one audit event for the client it names.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ACCOUNTING, adminScope, MINUTE } from '../../test/helpers/auth';
import { bookedWeek, WEEK, type Booking } from '../../test/helpers/booking';
import { caller, formPost, type Caller } from '../../test/helpers/callers';
import { eventsAfter, headSeq } from '../../test/helpers/reference';
import { exportClient } from '../db/exports';
import { racingRead } from '../db/test-support';
import { appendSyntheticEvents } from '../db/test-support-backup';
import { countOf, stampSubmission } from '../db/test-support-csv';
import { noteKeks, readEnv } from '../lib/env';

const RANGE = { from: '2026-01-05', to: '2026-01-11' };
const stale = () => caller([ACCOUNTING], { stepUpAgo: 16 * MINUTE });
const fresh = () => caller([ACCOUNTING]);

const exportOf = (who: Caller | null, clientId: string, fields: Record<string, string> = RANGE) =>
  formPost(`/export/${clientId}.csv`, null, who, fields);

/** A booked member whose week is in the given state, with four hours on Monday. */
async function weekIn(state: 'approved' | 'submitted' | null): Promise<Booking> {
  const b = await bookedWeek();
  if (state !== null) {
    await stampSubmission(env.DB, b.who.personId, WEEK, state);
  }
  return b;
}

describe('export', () => {
  it('SEC-24 a stale passkey confirmation, a member and a signed-out caller get no file and no event', async () => {
    const b = await weekIn('approved');
    const before = await headSeq();
    const member = await caller();
    const refused: [Caller | null, number][] = [
      [await stale(), 403],
      [member, 403],
      [null, 401],
    ];
    for (const [who, status] of refused) {
      const response = await exportOf(who, b.clientId);
      expect(response.status).toBe(status);
      expect(response.headers.get('content-type')).not.toContain('text/csv');
    }
    expect(await (await exportOf(await stale(), b.clientId)).text()).toContain(
      'Confirm with your passkey',
    );
    expect(await eventsAfter(before)).toEqual([]);
  });

  it('SEC-24 a fresh accounting admin gets an uncached attachment and one event for the client', async () => {
    const b = await weekIn('approved');
    const before = await headSeq();
    const response = await exportOf(await fresh(), b.clientId);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="[\x20-\x7e]+\.csv"$/,
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    const lines = (await response.text()).trimEnd().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('4.00');
    const events = await eventsAfter(before);
    expect(events.map((e) => [e.action, e.client_id])).toEqual([['export.client', b.clientId]]);
    expect(JSON.parse(events[0]?.after_json ?? '{}')).toMatchObject({
      entries: 1,
      hundredths: 400,
    });
  });

  it('SEC-24 exporting two clients writes one event for each and none for a third left alone', async () => {
    const [one, two, other] = [
      await weekIn('approved'),
      await weekIn('approved'),
      await weekIn('approved'),
    ];
    const before = await headSeq();
    const who = await fresh();
    expect((await exportOf(who, one.clientId)).status).toBe(200);
    expect((await exportOf(who, two.clientId)).status).toBe(200);
    const events = await eventsAfter(before);
    expect(events.map((e) => e.client_id).toSorted()).toEqual(
      [one.clientId, two.clientId].toSorted(),
    );
    expect(events.map((e) => e.client_id)).not.toContain(other.clientId);
  });

  it("SEC-24 an audited write landing between the export's head read and its event retries once and still writes the one event", async () => {
    const b = await weekIn('approved');
    const scope = await adminScope();
    const keks = noteKeks(readEnv(env));
    const race = () => appendSyntheticEvents(env.DB, 1, Date.now());
    const before = await headSeq();
    const once = racingRead(env.DB, 'INSERT INTO audit_event', race, 1);
    const file = await exportClient(scope, once, keks, b.clientId, RANGE, Date.now());
    expect(file.text).toContain('4.00');
    const events = await eventsAfter(before);
    expect(events.map((e) => e.action)).toEqual(['drill.event', 'export.client']);
    const mid = await headSeq();
    const twice = racingRead(env.DB, 'INSERT INTO audit_event', race, 2);
    await expect(
      exportClient(scope, twice, keks, b.clientId, RANGE, Date.now()),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect((await eventsAfter(mid)).map((e) => e.action)).toEqual(['drill.event', 'drill.event']);
  });

  it('a week that is submitted or still a draft is left out of the file', async () => {
    const submitted = await weekIn('submitted');
    const draft = await weekIn(null);
    const who = await fresh();
    for (const b of [submitted, draft]) {
      const text = await (await exportOf(who, b.clientId)).text();
      expect(text.trimEnd().split('\r\n')).toHaveLength(1);
    }
  });

  it('a bad range or an unknown client is refused and writes no event', async () => {
    const b = await weekIn('approved');
    const who = await fresh();
    const before = await headSeq();
    const bad = [
      { from: '2026-01-11', to: '2026-01-05' },
      { from: 'garbage', to: '2026-01-05' },
      { from: '2024-01-01', to: '2026-01-01' },
      {},
    ];
    for (const fields of bad) expect((await exportOf(who, b.clientId, fields)).status).toBe(400);
    expect((await exportOf(who, 'no-such-client')).status).toBe(404);
    expect(await eventsAfter(before)).toEqual([]);
  });
});

describe('a download that fails validation answers a page', () => {
  const REVERSED = { from: '2026-01-11', to: '2026-01-05' };
  const TOO_LONG = { from: '2025-01-01', to: '2026-02-05' };

  it('a reversed range and a 400-day range get a page naming the reason with a link back, from both download routes', async () => {
    const b = await weekIn('approved');
    const who = await fresh();
    const before = await headSeq();
    const cases = [
      [`/export/${b.clientId}.csv`, REVERSED, 'the start date is after the end date', '/export'],
      [`/export/${b.clientId}.csv`, TOO_LONG, 'a range covers at most', '/export'],
      ['/reports/week.csv', REVERSED, 'the start date is after the end date', '/reports'],
      ['/reports/week.csv', TOO_LONG, 'a range covers at most', '/reports'],
    ] as const;
    for (const [path, fields, reason, back] of cases) {
      const response = await formPost(path, null, who, fields);
      expect(response.status, path).toBe(400);
      expect(response.headers.get('content-type'), path).toMatch(/^text\/html/);
      const html = await response.text();
      expect(html, path).toContain(reason);
      expect(html, path).toContain(`<a href="${back}">`);
      expect(html, path).not.toContain('"error"');
    }
    expect(await eventsAfter(before)).toEqual([]);
  });
});

describe('reports', () => {
  it('SEC-24 a report needs the same confirmation, labels every week state, and writes one event', async () => {
    await weekIn('approved');
    await weekIn('submitted');
    await weekIn(null);
    const path = '/reports/week.csv';
    expect((await formPost(path, null, await stale(), RANGE)).status).toBe(403);
    const before = await headSeq();
    const response = await formPost(path, null, await fresh(), RANGE);
    expect(response.status).toBe(200);
    const rows = (await response.text()).trimEnd().split('\r\n');
    expect(rows[0]).toBe('Week Start,State,Hours');
    // Every booked person in this file has exactly four hours in the week, so each state's total is 400 a person.
    const total = async (
      what: 'bookedPeopleApproved' | 'bookedPeopleDraft' | 'bookedPeopleSubmitted',
    ) => `${String((await countOf(env.DB, what, WEEK)) * 4)}.00`;
    const expected = [
      `2026-01-05,approved,${await total('bookedPeopleApproved')}`,
      `2026-01-05,draft,${await total('bookedPeopleDraft')}`,
      `2026-01-05,submitted,${await total('bookedPeopleSubmitted')}`,
    ];
    expect(rows.slice(1)).toEqual(expected);
    expect((await eventsAfter(before)).map((e) => [e.action, e.target])).toEqual([
      ['report.csv', 'report:week'],
    ]);
    expect((await formPost('/reports/nonsense.csv', null, await fresh(), RANGE)).status).toBe(404);
  });
});
