import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { SEED_CLIENT_IDS, SEED_IDS } from '../../test/seed/build';
import { currentWeekStatements, MEMBER_INDEX, ROW_COUNT } from '../../test/seed/current-week';
import { loadSeed } from '../../test/seed/load';
import {
  FIRST_SUBMITTER,
  ROW_HUNDREDTHS,
  ROWS_EACH,
  submittedStatements,
} from '../../test/seed/submitted';
import { currentEnv, noteKeks } from '../lib/env';
import { openNote } from '../lib/note-crypto';
import { submittedWeeks } from './approvals';
import { keyRing } from './client-keys';
import { saveCells, seal } from './entry-writes';
import { scopeFor } from './scope';

async function count(sql: string): Promise<number> {
  const row = await env.DB.prepare(sql).first<{ n: number }>();
  return row?.n ?? -1;
}

describe('synthetic seed', () => {
  beforeAll(async () => {
    await loadSeed(env.DB, currentEnv().NOTE_KEK);
  });

  it('builds 2 firms, 100 people and 40 projects', async () => {
    expect(await count('SELECT count(*) AS n FROM firm')).toBe(2);
    expect(await count('SELECT count(*) AS n FROM person')).toBe(100);
    expect(await count('SELECT count(*) AS n FROM project')).toBe(40);
    expect(await count('SELECT count(*) AS n FROM task_code')).toBe(8);
  });

  it('every project allows a task and every person is assigned', async () => {
    const bare = 'SELECT count(*) AS n FROM project p WHERE NOT EXISTS';
    expect(await count(`${bare} (SELECT 1 FROM project_task t WHERE t.project_id = p.id)`)).toBe(0);
    expect(
      await count(
        'SELECT count(*) AS n FROM person p WHERE NOT EXISTS (SELECT 1 FROM assignment a WHERE a.person_id = p.id)',
      ),
    ).toBe(0);
  });

  it("a firm's internal projects book to its own client", async () => {
    const internal = await count(
      'SELECT count(*) AS n FROM project p JOIN firm f ON f.client_id = p.client_id',
    );
    expect(internal).toBe(4);
  });

  it('loading the seed again adds nothing', async () => {
    await loadSeed(env.DB, currentEnv().NOTE_KEK);
    expect(await count('SELECT count(*) AS n FROM person')).toBe(100);
  });
});

describe('the seed is usable for notes', () => {
  const WEEK = '2026-01-05';
  const kek = () => currentEnv().NOTE_KEK;
  const keks = () => noteKeks();

  it('every seeded client has a live wrapped key, and a note seals under each', async () => {
    const ring = keyRing(env.DB, keks());
    expect(SEED_CLIENT_IDS).toHaveLength(await count('SELECT count(*) AS n FROM client'));
    for (const clientId of SEED_CLIENT_IDS) {
      expect(await ring.has(clientId), clientId).toBe(true);
      const [ct, iv, version] = await seal(ring, clientId, 'entry', 'a note');
      expect(ct, clientId).not.toBeNull();
      expect(iv).not.toBeNull();
      expect(version).toBe(1);
    }
  });

  it('a client with no key refuses a note in its own words, not as erased', async () => {
    await env.DB.exec(
      "INSERT INTO client (id, name, created_at) VALUES ('no-key', 'Keyless Example', 1);",
    );
    await expect(seal(keyRing(env.DB, keks()), 'no-key', 'entry', 'a note')).rejects.toMatchObject({
      code: 'no_client_key',
    });
    await env.DB.exec(
      [
        "INSERT INTO client (id, name, created_at, erased_at) VALUES ('erased', 'Erased Example', 1, 2);",
        "INSERT INTO client_key (client_id, version, wrapped, iv, kek_id, created_at, destroyed_at) VALUES ('erased', 1, NULL, NULL, 'x', 1, 2);",
      ].join('\n'),
    );
    await expect(seal(keyRing(env.DB, keks()), 'erased', 'entry', 'a note')).rejects.toThrow(
      /has been erased/,
    );
  });

  it('the current-week rows are ten, carry readable notes, and saveCells with a note lands on each', async () => {
    await env.DB.exec((await currentWeekStatements(WEEK, kek())).join('\n'));
    const person = SEED_IDS.person(MEMBER_INDEX + 1);
    expect(
      await count(
        `SELECT count(*) AS n FROM week_row WHERE person_id = '${person}' AND week_start = '${WEEK}'`,
      ),
    ).toBe(ROW_COUNT);
    const stored = await env.DB.prepare(
      `SELECT e.id, e.client_id, e.note_ct, e.note_iv, e.hundredths FROM entry e JOIN week_row w ON w.id = e.row_id WHERE w.person_id = ?1`,
    )
      .bind(person)
      .all<{
        id: string;
        client_id: string;
        note_ct: ArrayBuffer;
        note_iv: ArrayBuffer;
        hundredths: number;
      }>();
    expect(stored.results.length).toBeGreaterThanOrEqual(ROW_COUNT);
    const ring = keyRing(env.DB, keks());
    for (const e of stored.results) {
      const key = (await ring.current(e.client_id))?.key;
      expect(e.hundredths).toBeGreaterThan(0);
      const text = await openNote(key ?? new Uint8Array(32), e.client_id, e.id, {
        ct: new Uint8Array(e.note_ct),
        iv: new Uint8Array(e.note_iv),
      });
      expect(text).not.toBe('');
    }
    const scope = await scopeFor(env.DB, person);
    const rows = await env.DB.prepare('SELECT id FROM week_row WHERE person_id = ?1')
      .bind(person)
      .all<{ id: string }>();
    const edits = rows.results.map((r) => ({
      rowId: r.id,
      dow: 6,
      hundredths: 100,
      note: 'Sunday catch-up',
    }));
    await saveCells(scope, env.DB, keks(), WEEK, edits, Date.now());
    expect(await count('SELECT count(*) AS n FROM entry WHERE dow = 6')).toBe(ROW_COUNT);
  });
});

describe('the seed has weeks waiting for approval, dated sensibly', () => {
  const LAST = '2026-11-09';
  const BEFORE = '2026-11-02';
  const DAY = 24 * 60 * 60 * 1000;

  it('the approvals list over the seed shows each submitter with hours that match an independent sum, each submitted within or just after its week', async () => {
    await loadSeed(env.DB, currentEnv().NOTE_KEK);
    await env.DB.exec(
      [...submittedStatements(LAST, 30), ...submittedStatements(BEFORE, 10)].join('\n'),
    );
    const admin = await scopeFor(env.DB, SEED_IDS.person(1));
    const listed = await submittedWeeks(admin, env.DB);
    expect(listed).toHaveLength(40);
    expect(new Set(listed.map((w) => w.person_id)).size).toBe(30);
    // Four eight-hour days and a four-hour Friday per row: 36 hours a row, written out rather than imported.
    expect(ROW_HUNDREDTHS).toBe(4 * 800 + 400);
    for (const week of listed) {
      expect(week.total, week.name).toBe(ROWS_EACH * 3600);
      const start = Date.parse(`${week.week_start}T00:00:00Z`);
      expect(week.submitted_at).toBeGreaterThanOrEqual(start);
      expect(week.submitted_at).toBeLessThan(start + 7 * DAY + 3 * DAY);
    }
    const ids = new Set(listed.map((w) => w.person_id));
    for (const fixture of [1, 2, 3]) expect(ids.has(SEED_IDS.person(fixture))).toBe(false);
    expect(ids.has(SEED_IDS.person(FIRST_SUBMITTER + 1))).toBe(true);
  });

  it('submitting the same weeks again adds nothing', async () => {
    const before = await count('SELECT count(*) AS n FROM week_submission');
    await env.DB.exec(submittedStatements(LAST, 30).join('\n'));
    expect(await count('SELECT count(*) AS n FROM week_submission')).toBe(before);
  });
});
