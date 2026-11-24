import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { approvedEntries } from '../db/export-rows';
import { systemScope } from '../db/scope';
import { loadSeededWeek, type SeededEntry } from '../db/test-support-week';
import { exportCsv, exportRows } from './export';
import type { ExportMapping } from './csv-mapping';
import { SAMPLE_EXPORT_MAPPING } from './csv-samples';
import { parseCsv } from './csv';
import { currentEnv, noteKeks } from './env';
import { addDays } from './week';

const WEEK = '2026-01-05';
const ALDER = 'c1000000-0000-4000-8000-000000000003';
let model: SeededEntry[] = [];
const range = { from: WEEK, to: addDays(WEEK, 6) };
const scope = systemScope();

/** Hundredths from "7.50" by splitting the text, not by the formatter under test. */
const hundredths = (text: string): number => {
  const [whole = '0', frac = '0'] = text.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
};

beforeAll(async () => {
  model = await loadSeededWeek(env.DB, currentEnv().NOTE_KEK, WEEK);
});

async function exportedFor(clientId: string, mapping: ExportMapping): Promise<string[][]> {
  const entries = await approvedEntries(scope, env.DB, noteKeks(), clientId, range);
  return parseCsv(exportCsv(entries, mapping));
}

describe('export', () => {
  it('the seeded week for one client matches its golden file', async () => {
    const entries = await approvedEntries(scope, env.DB, noteKeks(), ALDER, range);
    expect(entries.length).toBeGreaterThan(20);
    await expect(exportCsv(entries, SAMPLE_EXPORT_MAPPING)).toMatchFileSnapshot(
      '../../test/golden/export-week.csv',
    );
  });

  it('exporting every client and parsing the files back gives hours per person, project and day equal to an independent sum', async () => {
    const clients = [...new Set(model.map((e) => e.clientId))];
    const read = new Map<string, number>();
    for (const clientId of clients) {
      const [header, ...rows] = await exportedFor(clientId, SAMPLE_EXPORT_MAPPING);
      const col = (name: string) => header?.indexOf(name) ?? -1;
      for (const row of rows) {
        const key = [row[col('Worker')], row[col('Job No')], row[col('Day')]].join('|');
        read.set(key, (read.get(key) ?? 0) + hundredths(row[col('Hours')] ?? ''));
      }
    }
    const expected = new Map<string, number>();
    for (const e of model) {
      const key = [e.personCode, e.projectNumber, e.date].join('|');
      expected.set(key, (expected.get(key) ?? 0) + e.hundredths);
    }
    expect(expected.size).toBeGreaterThan(200);
    expect(read).toEqual(expected);
  });

  it('notes are opened for the client alone and the mapping caps their length', async () => {
    const rows = await exportedFor(ALDER, SAMPLE_EXPORT_MAPPING);
    const notes = rows.slice(1).map((r) => r[6] ?? '');
    const expected = model.filter((e) => e.clientId === ALDER && e.note !== '').map((e) => e.note);
    expect(expected.length).toBeGreaterThan(0);
    expect(notes.filter((n) => n !== '').toSorted()).toEqual(expected.toSorted());
    const capped = exportRows(
      [{ ...entryFixture(), note: 'x'.repeat(300) }],
      SAMPLE_EXPORT_MAPPING,
    );
    expect(capped[1]?.[6]).toHaveLength(100);
  });

  it('a mapping in settings, not code, decides headers, order, templates, date layout and the byte order mark', () => {
    const mapping: ExportMapping = {
      date_format: 'dmy',
      bom: true,
      columns: [
        { header: 'Who', field: 'person_name' },
        { header: 'Ref', template: '{project_number}/{task_code} wk {week_start}' },
        { header: 'When', field: 'date' },
        { header: 'Fixed', literal: 'A' },
      ],
    };
    expect(exportCsv([entryFixture()], mapping)).toBe(
      '﻿Who,Ref,When,Fixed\r\nAda Example,26-0001/DES wk 05/01/2026,07/01/2026,A\r\n',
    );
  });

  it('a 2,000-character note of whitespace exports in linear time and collapses line breaks to one space', () => {
    const spaced = `a${' '.repeat(1998)}b`;
    const entries = Array.from({ length: 200 }, () => ({ ...entryFixture(), note: spaced }));
    const started = performance.now();
    const rows = exportRows(entries, SAMPLE_EXPORT_MAPPING);
    expect(performance.now() - started).toBeLessThan(100);
    expect(rows[1]?.[6]).toBe(`a${' '.repeat(99)}`);
    const broken = 'first line \r\n\r\n  second\n \n\tthird\n';
    const [, one] = exportRows([{ ...entryFixture(), note: broken }], SAMPLE_EXPORT_MAPPING);
    expect(one?.[6]).toBe('first line second third ');
  });

  it('SEC-14 a note that starts like a formula leaves the file as text', () => {
    const csv = exportCsv([{ ...entryFixture(), note: '=1+1' }], SAMPLE_EXPORT_MAPPING);
    expect(csv).toContain("'=1+1");
    expect(csv).not.toMatch(/,=1\+1/);
  });
});

function entryFixture() {
  return {
    date: '2026-01-07',
    weekStart: '2026-01-05',
    personName: 'Ada Example',
    personEmail: 'ada@practice.example',
    personCode: 'R1000',
    clientName: 'Alder Street Bakery',
    projectNumber: '26-0001',
    projectName: 'Kitchen refit',
    taskCode: 'DES',
    taskName: 'Design',
    hundredths: 750,
    note: '',
  };
}
