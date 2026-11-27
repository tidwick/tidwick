import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { demoClientIds } from '../../test/demo/build';
import { demoSeedStatements } from '../../test/demo/seed';
import { DEMO_WEEKS } from '../../test/demo/weeks';
import { currentEnv, noteKeks } from '../lib/env';
import { openNote } from '../lib/note-crypto';
import { addDays } from '../lib/week';
import { blobBytes } from './credentials';
import { keyRing } from './client-keys';

const WEEK = '2026-11-16';

async function count(sql: string): Promise<number> {
  const row = await env.DB.prepare(sql).first<{ n: number }>();
  return row?.n ?? -1;
}

async function load(): Promise<void> {
  await env.DB.exec((await demoSeedStatements(currentEnv().NOTE_KEK, WEEK)).join('\n'));
}

const TABLES = ['firm', 'person', 'project', 'week_row', 'entry', 'week_submission', 'client_key'];

async function counts(): Promise<number[]> {
  return Promise.all(TABLES.map((t) => count(`SELECT count(*) AS n FROM ${t}`)));
}

describe('the demo seed', () => {
  beforeAll(load);

  it('holds two invented firms, 26 people, 12 projects and a key per client', async () => {
    expect(await count('SELECT count(*) AS n FROM firm')).toBe(2);
    expect(await count('SELECT count(*) AS n FROM person')).toBe(26);
    expect(await count('SELECT count(*) AS n FROM project')).toBe(12);
    expect(await count('SELECT count(*) AS n FROM client_key')).toBe(demoClientIds.length);
    expect(await count("SELECT count(*) AS n FROM person_role WHERE role = 'admin'")).toBe(1);
  });

  it('books three months of weeks for every person, ending with the current week as a draft', async () => {
    const first = addDays(WEEK, -7 * (DEMO_WEEKS - 1));
    expect(await count('SELECT count(DISTINCT week_start) AS n FROM week_row')).toBe(13);
    expect(
      await count(
        `SELECT count(*) AS n FROM week_row WHERE week_start < '${first}' OR week_start > '${WEEK}'`,
      ),
    ).toBe(0);
    expect(
      await count(
        'SELECT count(*) AS n FROM (SELECT person_id, week_start FROM week_row GROUP BY 1, 2)',
      ),
    ).toBe(26 * 13);
    expect(
      await count(`SELECT count(*) AS n FROM week_submission WHERE week_start = '${WEEK}'`),
    ).toBe(0);
  });

  it('has weeks submitted, approved and returned, each decided week by an accounting admin', async () => {
    for (const state of ['submitted', 'approved', 'returned']) {
      expect(
        await count(`SELECT count(*) AS n FROM week_submission WHERE state = '${state}'`),
        state,
      ).toBeGreaterThan(0);
    }
    const undecided = `SELECT count(*) AS n FROM week_submission s WHERE s.state != 'submitted' AND NOT EXISTS
      (SELECT 1 FROM person_role r WHERE r.person_id = s.decided_by AND r.role = 'accounting_admin' AND r.person_id != s.person_id)`;
    expect(await count(undecided)).toBe(0);
    expect(
      await count(
        "SELECT count(*) AS n FROM week_submission WHERE state = 'submitted' AND decided_by IS NOT NULL",
      ),
    ).toBe(0);
  });

  it('has one person who left, with open weeks to approve on their behalf, and returned weeks that say why', async () => {
    const left = await env.DB.prepare('SELECT id FROM person WHERE offboarded_at IS NOT NULL').all<{
      id: string;
    }>();
    expect(left.results).toHaveLength(1);
    const id = left.results[0]?.id ?? '';
    const open = `SELECT count(*) AS n FROM week_row r WHERE r.person_id = '${id}' AND NOT EXISTS
      (SELECT 1 FROM week_submission s WHERE s.person_id = r.person_id AND s.week_start = r.week_start)`;
    expect(await count(open)).toBeGreaterThan(0);
    expect(
      await count("SELECT count(*) AS n FROM week_submission WHERE state = 'returned'"),
    ).toBeGreaterThan(0);
    expect(
      await count(
        "SELECT count(*) AS n FROM week_submission WHERE state = 'returned' AND (return_reason IS NULL OR return_reason = '')",
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT count(*) AS n FROM week_submission WHERE state != 'returned' AND return_reason IS NOT NULL",
      ),
    ).toBe(0);
  });

  it('every working day sums to a full day, and most cells carry a note that opens under NOTE_KEK', async () => {
    const days = `SELECT r.person_id, r.week_start, e.dow, sum(e.hundredths) AS total FROM entry e
      JOIN week_row r ON r.id = e.row_id GROUP BY 1, 2, 3`;
    const off = await count(`SELECT count(*) AS n FROM (${days}) WHERE total NOT IN (750, 800)`);
    expect(off).toBe(0);
    const noted = await count('SELECT count(*) AS n FROM entry WHERE note_ct IS NOT NULL');
    expect(noted / (await count('SELECT count(*) AS n FROM entry'))).toBeGreaterThan(0.7);
    const rows = await env.DB.prepare(
      'SELECT id, client_id, note_ct, note_iv, key_version FROM entry WHERE note_ct IS NOT NULL ORDER BY id LIMIT 40',
    ).all<{
      id: string;
      client_id: string;
      note_ct: ArrayBuffer;
      note_iv: ArrayBuffer;
      key_version: number;
    }>();
    const ring = keyRing(env.DB, noteKeks());
    for (const row of rows.results) {
      const key =
        (await ring.version(row.client_id, row.key_version)) ?? expect.unreachable('no key');
      const text = await openNote(key, row.client_id, row.id, {
        ct: blobBytes(row.note_ct),
        iv: blobBytes(row.note_iv),
      });
      expect(text.length, row.id).toBeGreaterThan(5);
    }
  });

  it('loading it again changes nothing', async () => {
    const before = await counts();
    await load();
    expect(await counts()).toEqual(before);
  });
});
