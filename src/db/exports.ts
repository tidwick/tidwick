// A file leaving: an export or a report is built, audited, and only then handed back, so no file exists that the
// audit log does not record (SEC-24). One export is one client and writes one event; a report writes one event.
import type { DateRange } from '../lib/date-range';
import { fail } from '../lib/errors';
import { exportCsv } from '../lib/export';
import type { NoteKeks } from '../lib/note-crypto';
import { reportCsv, type ReportKind } from '../lib/report';
import { appendEvent } from './audit';
import { clientById } from './clients';
import { loadExportMapping } from './csv-settings';
import { approvedEntries } from './export-rows';
import { reportRows } from './report-rows';
import type { Scope } from './scope';

export interface CsvFile {
  text: string;
  filename: string;
}

/** The client's approved time in the range through the saved export mapping, with one `export.clientCsv` event. */
export async function exportClient(
  scope: Scope,
  db: D1Database,
  keks: NoteKeks,
  clientId: string,
  range: DateRange,
  now: number,
): Promise<CsvFile> {
  if (scope.kind !== 'all') fail('forbidden');
  const client = (await clientById(scope, db, clientId)) ?? fail('not_found');
  const entries = await approvedEntries(scope, db, keks, client.id, range);
  const text = exportCsv(entries, await loadExportMapping(db));
  const hundredths = entries.reduce((sum, e) => sum + e.hundredths, 0);
  await appendEvent(scope, db, {
    at: now,
    action: 'export.clientCsv',
    clientId: client.id,
    target: `client:${client.id}`,
    after: { from: range.from, to: range.to, entries: entries.length, hundredths },
  });
  return { text, filename: `export-${client.name}-${range.from}-${range.to}` };
}

/** One report over the range with one `reports.download` event. */
export async function runReport(
  scope: Scope,
  db: D1Database,
  kind: ReportKind,
  range: DateRange,
  now: number,
): Promise<CsvFile> {
  const rows = await reportRows(scope, db, kind, range);
  const text = reportCsv(kind, rows);
  await appendEvent(scope, db, {
    at: now,
    action: 'reports.download',
    clientId: null,
    target: `report:${kind}`,
    after: { from: range.from, to: range.to, rows: rows.length },
  });
  return { text, filename: `report-${kind}-${range.from}-${range.to}` };
}
