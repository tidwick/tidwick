// Runs in the `app` project: the week and approver pages are rendered by the built Worker, and the no-script form
// posts through the real middleware, so these prove the ledger markup the browser receives.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ACCOUNTING, MINUTE } from '../../test/helpers/auth';
import { addRow, booking, cell, save, WEEK, weekOf } from '../../test/helpers/booking';
import { caller, formPost, getPage, type Fields } from '../../test/helpers/callers';
import { saveCsvMappings } from '../db/csv-settings';
import { SAMPLE_EXPORT_MAPPING, SAMPLE_IMPORT_MAPPING } from '../lib/csv-samples';

const PAGE = `/week/${WEEK}`;

const namesIn = (html: string): string[] =>
  [...html.matchAll(/name="(cell\.[^"]+)"/g)].map(([, name]) => name ?? '');

const openTags = (html: string, tag: string): string[] =>
  [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))].map(([found]) => found);

describe('the week page posts every note of a row with no script, and they round-trip', () => {
  it('the server markup names all seven note fields of a row, and posting them stores each note', async () => {
    const b = await booking();
    const [task] = b.tasks;
    if (!task) return expect.unreachable('the booking has tasks');
    const rowId = await addRow(b.who, WEEK, b.projectId, task);
    const html = await (await getPage(PAGE, b.who)).text();
    const names = namesIn(html).filter((name) => name.startsWith(`cell.${rowId}.`));
    const notes = names.filter((name) => name.endsWith('.note'));
    expect(notes).toEqual([0, 1, 2, 3, 4, 5, 6].map((dow) => `cell.${rowId}.${String(dow)}.note`));
    const fields: Fields = { weekStart: WEEK };
    for (const name of names) {
      const dow = name.split('.')[2] ?? '';
      fields[name] = name.endsWith('.hours') ? '1' : `ledger day ${dow}`;
    }
    const posted = await formPost(PAGE, 'entries.save', b.who, fields);
    expect(posted.status).toBe(303);
    const week = await weekOf(b.who, WEEK);
    expect(week.rows[0]?.cells.map((c) => c.note)).toEqual(
      [0, 1, 2, 3, 4, 5, 6].map((dow) => `ledger day ${String(dow)}`),
    );
    const again = await (await getPage(PAGE, b.who)).text();
    for (let dow = 0; dow < 7; dow++)
      expect(again).toContain(`>ledger day ${String(dow)}</textarea>`);
  });
});

describe('the approver page shows every ledger open and read-only once stepped up', () => {
  it('after step-up each row is open with its notes read-only; a stale step-up shows none of it', async () => {
    const b = await booking();
    const [first, second] = b.tasks;
    if (!first || !second) return expect.unreachable('the booking has two tasks');
    const one = await addRow(b.who, WEEK, b.projectId, first);
    const two = await addRow(b.who, WEEK, b.projectId, second);
    expect(
      (await save(b.who, WEEK, cell(one, 0, '2', 'kerb survey'), cell(two, 1, '3'))).status,
    ).toBe(200);
    const path = `/approvals/${b.who.personId}/${WEEK}`;
    const stale = await getPage(path, await caller([ACCOUNTING], { stepUpAgo: 16 * MINUTE }));
    expect(stale.status).toBe(403);
    expect(await stale.text()).not.toContain('kerb survey');
    const page = await getPage(path, await caller([ACCOUNTING], { stepUpAgo: MINUTE }));
    expect(page.status).toBe(200);
    const html = await page.text();
    const details = openTags(html, 'details');
    expect(details).toHaveLength(2);
    for (const tag of details) expect(tag).toMatch(/\sopen=""/);
    const notes = openTags(html, 'textarea');
    // Only the days that hold something are drawn: Monday's note on the first row, Tuesday's hours on the second.
    expect(notes).toHaveLength(2);
    for (const tag of notes) expect(tag).toMatch(/\sreadonly=""/i);
    expect(html).toContain('>kerb survey</textarea>');
    expect(html).toContain('Hours with no note: Tue');
  });
});

describe('the note counter follows the saved export mapping', () => {
  it('the sample mapping’s note limit shows a counter on a written note; a mapping with none shows none', async () => {
    const b = await booking();
    const [task] = b.tasks;
    if (!task) return expect.unreachable('the booking has tasks');
    const rowId = await addRow(b.who, WEEK, b.projectId, task);
    expect((await save(b.who, WEEK, cell(rowId, 2, '1', 'kerb'))).status).toBe(200);
    const limit = SAMPLE_EXPORT_MAPPING.columns.find((c) => c.field === 'note')?.max;
    expect(limit).toBeTypeOf('number');
    const sampled = await (await getPage(PAGE, b.who)).text();
    expect(sampled).toContain(`>4 of ${String(limit)}</p>`);
    const unlimited = {
      ...SAMPLE_EXPORT_MAPPING,
      columns: SAMPLE_EXPORT_MAPPING.columns.map((column) =>
        column.field === 'note' ? { header: column.header, field: column.field } : column,
      ),
    };
    await saveCsvMappings(
      b.admin,
      env.DB,
      { export: unlimited, import: SAMPLE_IMPORT_MAPPING },
      Date.now(),
    );
    const plain = await (await getPage(PAGE, b.who)).text();
    expect(plain).not.toMatch(/\d+ of \d+/);
  });
});
