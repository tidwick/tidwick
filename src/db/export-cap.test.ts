// An export holds every row of its range in memory, so one that would pass the row cap, or whose rows and notes
// are estimated past the memory cap, is refused before any row is read, and names the fix (ADR 0010).
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { adminScope, T0 } from '../../test/helpers/auth';
import { bookedWeek, WEEK } from '../../test/helpers/booking';
import { isAppError } from '../lib/errors';
import { exportBytes, MAX_EXPORT_BYTES, MAX_EXPORT_ROWS } from '../lib/limits';
import { noteKeks } from '../lib/env';
import { saveCells } from './entry-writes';
import { approvedEntries } from './export-rows';
import { stampSubmission } from './test-support-csv';

const RANGE = { from: '2026-01-05', to: '2026-01-11' };
const NOTE = 'n'.repeat(2_000);
/** AES-GCM adds a 16-byte tag to the note's UTF-8 bytes. */
const NOTE_CT_BYTES = NOTE.length + 16;

/** The statements a database was asked to prepare, in order, passed through to the real one. */
function recording(db: D1Database): { db: D1Database; sql: string[] } {
  const sql: string[] = [];
  const spy = { prepare: (text: string) => (sql.push(text), db.prepare(text)) };
  return { db: spy as unknown as D1Database, sql };
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  const refused = await promise.catch((error: unknown) => error);
  expect(isAppError(refused, 'invalid_input')).toBe(true);
  return String((refused as { detail?: string }).detail);
}

describe('SEC-36 an export is bounded by rows and by memory', () => {
  it('SEC-36 a range with more approved entries than the cap is refused before any row is read, and one at the cap is built', async () => {
    const b = await bookedWeek();
    await stampSubmission(env.DB, b.who.personId, WEEK, 'approved');
    const scope = await adminScope();
    const held = (await approvedEntries(scope, env.DB, noteKeks(), b.clientId, RANGE)).length;
    expect(held).toBeGreaterThan(0);
    const bytes = MAX_EXPORT_BYTES;

    const atCap = recording(env.DB);
    expect(
      await approvedEntries(scope, atCap.db, noteKeks(), b.clientId, RANGE, { rows: held, bytes }),
    ).toHaveLength(held);
    expect(atCap.sql.map((s) => s.includes('ORDER BY'))).toEqual([false, true]);

    const over = recording(env.DB);
    const cap = { rows: held - 1, bytes };
    const detail = await refusal(
      approvedEntries(scope, over.db, noteKeks(), b.clientId, RANGE, cap),
    );
    expect(detail).toContain('choose a shorter range');
    expect(over.sql).toHaveLength(1);
    expect(over.sql[0]).not.toContain('ORDER BY');
  });

  it('SEC-36 a range under the row cap whose notes weigh past the memory cap is refused before any row is read, and one at it is built', async () => {
    const b = await bookedWeek();
    const edit = { rowId: b.rowId, dow: 1, hundredths: 100, note: NOTE };
    await saveCells(b.member, env.DB, noteKeks(), WEEK, [edit], T0);
    await stampSubmission(env.DB, b.who.personId, WEEK, 'approved');
    const scope = await adminScope();
    const weight = 2 * 2_500 + NOTE_CT_BYTES * 10;

    const atCap = recording(env.DB);
    const fits = { rows: MAX_EXPORT_ROWS, bytes: weight };
    const built = await approvedEntries(scope, atCap.db, noteKeks(), b.clientId, RANGE, fits);
    expect(built.map((e) => e.note.length)).toEqual([0, NOTE.length]);

    const over = recording(env.DB);
    const cap = { rows: MAX_EXPORT_ROWS, bytes: weight - 1 };
    const detail = await refusal(
      approvedEntries(scope, over.db, noteKeks(), b.clientId, RANGE, cap),
    );
    expect(detail).toContain('notes are too long');
    expect(detail).toContain('choose a shorter range');
    expect(over.sql).toHaveLength(1);
  });

  it('SEC-36 at the default caps 20,000 entries without notes fit, and 20,000 with 300-character notes are refused by weight', () => {
    expect(MAX_EXPORT_ROWS).toBe(20_000);
    expect(exportBytes(20_000, 0)).toBeLessThanOrEqual(MAX_EXPORT_BYTES);
    expect(exportBytes(20_000, 20_000 * 316)).toBeGreaterThan(MAX_EXPORT_BYTES);
    expect(exportBytes(12_000, 12_000 * 316)).toBeGreaterThan(MAX_EXPORT_BYTES);
    expect(exportBytes(6_600, 6_600 * 316)).toBeLessThanOrEqual(MAX_EXPORT_BYTES);
  });
});
