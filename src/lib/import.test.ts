import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import fixture from '../../test/fixtures/timesheet-import.csv?raw';
import { setupImport, IMPORT_MAPPING, PEOPLE } from '../../test/helpers/import-setup';
import { T0 } from '../../test/helpers/auth';
import { approvedEntries } from '../db/export-rows';
import { countOf, onlyImportBatchId, projectIdNamed } from '../db/test-support-csv';
import { applyImport, previewImport } from '../db/import-apply';
import { allowedTasks } from '../db/project-tasks';
import { isAppError } from './errors';
import { MAX_IMPORT_BYTES, readImport } from './import';
import { DEFAULT_POLICY } from './policy';

const bytes = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);
const FILE = bytes(fixture);
let ctx: Awaited<ReturnType<typeof setupImport>>;

beforeAll(async () => {
  ctx = await setupImport();
});

/** The fixture's first nine data lines and its last two (new projects) are the ones that should land; their hours read by splitting on commas up to the last column. */
function independentHundredths(): number {
  const all = fixture.trimEnd().split('\r\n');
  const lines = [...all.slice(1, 10), ...all.slice(-2)];
  return lines.reduce((sum, line) => {
    const [whole = '0', frac = ''] = (line.split(',')[6] ?? '').split('.');
    const places = frac.padEnd(3, '0');
    return (
      sum + Number(whole) * 100 + Number(places.slice(0, 2)) + (places.charAt(2) >= '5' ? 1 : 0)
    );
  }, 0);
}

describe('import', () => {
  it('previews the fixture without writing: rows read, entries, rounded rows, new references and what an admin must add', async () => {
    const before = await countOf(env.DB, 'entries');
    const report = await previewImport(ctx.admin, env.DB, FILE);
    expect(report).toMatchObject({
      applied: false,
      rowsRead: 17,
      entries: 10,
      roundedRows: 1,
      rejectedCount: 6,
      newClients: ['Ivywood Library'],
      weeksApproved: 5,
      span: { from: '2026-01-05', to: '2026-01-13' },
    });
    expect(report.approvedWeeks).toHaveLength(5);
    expect(report.hundredths).toBe(independentHundredths());
    expect(report.newProjects.map((p) => p.name).toSorted()).toEqual(['Annex', 'Reading room']);
    expect(report.needsAdmin).toEqual(['add task code ZZZ']);
    expect(await countOf(env.DB, 'entries')).toBe(before);
    expect(await countOf(env.DB, 'clientsNamed', 'Ivywood Library')).toBe(0);
  });

  it('every rejected row carries a named reason and its line', async () => {
    const { rejected } = await previewImport(ctx.admin, env.DB, FILE);
    const reasons = new Map(rejected.map((r) => [r.line, r.reason]));
    expect(reasons.get(11)).toBe('bad date "01/32/2026"');
    expect(reasons.get(12)).toBe('unknown person nobody@import.example');
    expect(reasons.get(13)).toBe('bad hours "abc"');
    expect(reasons.get(14)).toBe('malformed row: expected 8 cells, found 3');
    expect(reasons.get(15)).toBe('unknown task code "ZZZ"');
    expect(reasons.get(16)).toBe('day over 24 hours on 2026-01-05');
    expect(rejected).toHaveLength(6);
  });

  it('applies the fixture: entries and hours equal an independent sum, notes join, weeks are approved', async () => {
    const projectsBefore = await countOf(env.DB, 'projects');
    const report = await applyImport(ctx.admin, env.DB, ctx.keks, FILE, T0);
    expect(report).toMatchObject({ applied: true, rowsRead: 17, entries: 10, rejectedCount: 6 });
    const hash = await onlyImportBatchId(env.DB);
    expect(await countOf(env.DB, 'entriesOfImport', hash)).toBe(10);
    expect(await countOf(env.DB, 'hundredthsOfImport', hash)).toBe(independentHundredths());
    expect(await countOf(env.DB, 'approvedWeeksOfPrefix', 'imp-%')).toBe(5);
    const range = { from: '2026-01-05', to: '2026-01-18' };
    const notes = (await approvedEntries(ctx.admin, env.DB, ctx.keks, ctx.clientId, range))
      .map((e) => e.note)
      .filter((n) => n !== '')
      .toSorted();
    expect(notes).toEqual([
      '=SUM(A1)',
      'Counter drawings',
      'Notes, with a comma and "quotes"',
      'kickoff; follow up',
    ]);
    expect(await countOf(env.DB, 'clientsNamed', 'Ivywood Library')).toBe(1);
    expect((await countOf(env.DB, 'projects')) - projectsBefore).toBe(2);
  });

  it('SEC-25 applying the same file twice creates no duplicate entries, clients, projects or batches', async () => {
    const entries = await countOf(env.DB, 'entries');
    const clients = await countOf(env.DB, 'clients');
    const projects = await countOf(env.DB, 'projects');
    const again = await applyImport(ctx.admin, env.DB, ctx.keks, FILE, T0 + 1);
    expect(again).toMatchObject({
      entries: 0,
      alreadyApplied: 10,
      rejectedCount: 6,
      newClients: [],
    });
    expect(await countOf(env.DB, 'entries')).toBe(entries);
    expect(await countOf(env.DB, 'clients')).toBe(clients);
    expect(await countOf(env.DB, 'projects')).toBe(projects);
    expect(await countOf(env.DB, 'importBatches')).toBe(1);
    expect(await countOf(env.DB, 'importBatchEntries')).toBe(10);
  });

  it('the projects the file created allow the tasks its rows named, and the hours landed on them', async () => {
    const annex = await projectIdNamed(env.DB, 'Annex');
    const allowed = await allowedTasks(ctx.admin, env.DB, annex);
    expect(allowed.map((t) => t.code)).toEqual(['DES']);
    expect(await countOf(env.DB, 'importedEntries')).toBe(10);
  });

  it('SEC-25 a cell that already holds hours from elsewhere is rejected, not overwritten', async () => {
    const text = `Work Date,Staff Email,Customer,Job,Job No,Activity,Hrs,Memo\r\n01/05/2026,${PEOPLE[0]?.email ?? ''},Marlowe Bakery,Shopfit,26-0101,DES,1,again\r\n`;
    const report = await applyImport(ctx.admin, env.DB, ctx.keks, bytes(text), T0 + 4);
    expect(report).toMatchObject({ entries: 0, rejectedCount: 1 });
    expect(report.rejected[0]?.reason).toBe('that cell already holds hours from elsewhere');
  });

  it('a file that is not UTF-8 is refused by name and writes nothing, where the same text in UTF-8 reads', async () => {
    const head = 'Work Date,Staff Email,Customer,Job,Job No,Activity,Hrs,Memo\r\n';
    const latin1 = new Uint8Array([
      ...bytes(`${head}01/05/2026,${PEOPLE[0]?.email ?? ''},Caf`),
      0xe9,
      ...bytes(',Bar,,DES,1,\r\n'),
    ]);
    const clients = await countOf(env.DB, 'clients');
    for (const run of [
      previewImport,
      (...a: Parameters<typeof previewImport>) => applyImport(a[0], a[1], ctx.keks, a[2], T0),
    ]) {
      const refused = await run(ctx.admin, env.DB, latin1).catch((error: unknown) => error);
      expect(isAppError(refused, 'invalid_input')).toBe(true);
      expect((refused as Error).message).toContain('not UTF-8');
    }
    expect(await countOf(env.DB, 'clients')).toBe(clients);
    const utf8 = bytes(`${head}01/05/2026,${PEOPLE[0]?.email ?? ''},Café,Bar,,DES,1,\r\n`);
    expect(await previewImport(ctx.admin, env.DB, utf8)).toMatchObject({ newClients: ['Café'] });
  });
});

describe('import files', () => {
  const header = 'Work Date,Staff Email,Customer,Job,Job No,Activity,Hrs,Memo';

  it('SEC-25 a file over the size or row cap, or without a mapped column, is refused before any row is read', () => {
    const refused = (text: string): boolean => {
      try {
        readImport(text, IMPORT_MAPPING, DEFAULT_POLICY.importMaxRows);
        return false;
      } catch (error) {
        return isAppError(error, 'invalid_input');
      }
    };
    const row = '01/05/2026,ada@import.example,C,P,,DES,1,';
    expect(
      refused(
        `${header}\n${Array(DEFAULT_POLICY.importMaxRows + 1)
          .fill(row)
          .join('\n')}`,
      ),
    ).toBe(true);
    expect(refused(`${header}\n${Array(DEFAULT_POLICY.importMaxRows).fill(row).join('\n')}`)).toBe(
      false,
    );
    expect(refused(`${header}\n${'x'.repeat(MAX_IMPORT_BYTES)}`)).toBe(true);
    expect(refused(header.replace('Hrs', 'Time'))).toBe(true);
    expect(refused('')).toBe(true);
  });

  it('SEC-25 only mapped columns are read: an extra column is ignored whatever it holds', () => {
    const read = readImport(
      `${header},Rate\r\n01/05/2026,ada@import.example,C,P,,DES,1,,=cmd|' /C calc'!A0\r\n`,
      IMPORT_MAPPING,
      DEFAULT_POLICY.importMaxRows,
    );
    expect(read.rejected).toEqual([]);
    expect(Object.values(read.rows[0] ?? {}).join('|')).not.toContain('cmd');
  });

  it('hours round half up past two places and count as rounded; blank notes and project numbers stay empty', () => {
    const read = readImport(
      `${header}\r\n01/05/2026,ada@import.example,C,P,,DES,"1,005",\r\n01/05/2026,ada@import.example,C,P,,DES,1.50,\r\n`,
      IMPORT_MAPPING,
      DEFAULT_POLICY.importMaxRows,
    );
    expect(read.rows.map((r) => [r.hundredths, r.rounded])).toEqual([
      [101, true],
      [150, false],
    ]);
    expect(read.rows[0]?.projectNumber).toBeNull();
  });
});
