// The week write paths at their caps stay inside D1's per-invocation query budget (src/lib/limits.ts), and the
// entry trigger still holds the 24 hour cap when the checks before the batch are out of date.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { adminScope, T0 } from '../../test/helpers/auth';
import { project } from '../../test/helpers/booking';
import { noteKeks } from '../lib/env';
import { D1_QUERIES_PER_INVOCATION, MAX_WEEK_ROWS } from '../lib/limits';
import { addDays } from '../lib/week';
import { caller } from '../../test/helpers/callers';
import { saveCells } from './entry-writes';
import { scopeFor } from './scope';
import { countingDb } from './test-support';
import { addRow, copyLastWeek } from './week-rows';
import { loadWeek } from './week-view';

const WEEK = '2026-01-05';
const keks = () => noteKeks();

/** A member with a project allowing as many tasks as a full week needs rows. */
async function fullWeek() {
  const admin = await adminScope();
  const who = await caller();
  const made = await project(admin, who, MAX_WEEK_ROWS);
  const scope = await scopeFor(env.DB, who.personId);
  for (const task of made.tasks) await addRow(scope, env.DB, WEEK, made.projectId, task.id);
  return { scope, who, made };
}

describe('week writes at their caps', () => {
  it('a save of every cell of a full week, each with a note, stays inside the query budget', async () => {
    const { scope, made } = await fullWeek();
    const rows = (await loadWeek(scope, env.DB, keks(), scope.actorId ?? '', WEEK)).rows;
    expect(rows).toHaveLength(MAX_WEEK_ROWS);
    const edits = rows.flatMap((row, r) =>
      Array.from({ length: 7 }, (_, dow) => ({
        rowId: row.rowId,
        dow,
        hundredths: 25 + (r % 3),
        note: `note ${String(r)} ${String(dow)}`,
      })),
    );
    expect(edits).toHaveLength(MAX_WEEK_ROWS * 7);
    const counted = countingDb(env.DB);
    await saveCells(scope, counted.db, keks(), WEEK, edits, T0);
    expect(counted.count()).toBeLessThan(D1_QUERIES_PER_INVOCATION);
    expect(counted.count()).toBeGreaterThanOrEqual(edits.length);
    const week = await loadWeek(scope, env.DB, keks(), scope.actorId ?? '', WEEK);
    expect(week.rows[3]?.cells[2]).toEqual({ hundredths: 25, note: 'note 3 2' });
    expect(made.tasks).toHaveLength(MAX_WEEK_ROWS);
  });

  it('opening a full week reads in a handful of queries however many notes it holds', async () => {
    const { scope } = await fullWeek();
    const rows = (await loadWeek(scope, env.DB, keks(), scope.actorId ?? '', WEEK)).rows;
    await saveCells(
      scope,
      env.DB,
      keks(),
      WEEK,
      rows.flatMap((row) =>
        [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ rowId: row.rowId, dow, hundredths: 10, note: 'n' })),
      ),
      T0,
    );
    const counted = countingDb(env.DB);
    await loadWeek(scope, counted.db, keks(), scope.actorId ?? '', WEEK);
    expect(counted.count()).toBeLessThanOrEqual(8);
  });

  it('copy last week of a full week stays inside the budget and cannot pass the row cap', async () => {
    const { scope, who } = await fullWeek();
    const counted = countingDb(env.DB);
    const added = await copyLastWeek(scope, counted.db, addDays(WEEK, 7));
    expect(added).toBe(MAX_WEEK_ROWS);
    expect(counted.count()).toBeLessThan(D1_QUERIES_PER_INVOCATION);
    expect(await copyLastWeek(scope, env.DB, addDays(WEEK, 7))).toBe(0);
    const extra = await project(await adminScope(), who, 1);
    await expect(
      addRow(scope, env.DB, addDays(WEEK, 7), extra.projectId, extra.tasks[0]?.id ?? ''),
    ).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });

  it('the entry trigger holds the 24 hour cap when two saves each pass their own check', async () => {
    const admin = await adminScope();
    const who = await caller();
    const made = await project(admin, who, 2);
    const scope = await scopeFor(env.DB, who.personId);
    const [a, b] = made.tasks;
    await addRow(scope, env.DB, WEEK, made.projectId, a?.id ?? '');
    await addRow(scope, env.DB, WEEK, made.projectId, b?.id ?? '');
    const rows = (await loadWeek(scope, env.DB, keks(), who.personId, WEEK)).rows;
    const outcomes = await Promise.allSettled(
      rows.map((row, n) =>
        saveCells(
          scope,
          env.DB,
          keks(),
          WEEK,
          [{ rowId: row.rowId, dow: 0, hundredths: n === 0 ? 1600 : 900, note: '' }],
          T0,
        ),
      ),
    );
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const refused = outcomes.find((o) => o.status === 'rejected');
    expect(refused?.status === 'rejected' && refused.reason).toMatchObject({ code: 'day_cap' });
    const total = (await loadWeek(scope, env.DB, keks(), who.personId, WEEK)).rows.reduce(
      (t, r) => t + (r.cells[0]?.hundredths ?? 0),
      0,
    );
    expect(total).toBeLessThanOrEqual(2400);
  });
});
