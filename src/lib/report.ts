// The three light reports as CSV rows: hours by person, by project and by week over a range. Every week state
// is included and labelled, so nothing reads as approved that is not. Pure; rows come from `report-rows.ts`.
import { encodeCsv } from './csv';
import { formatHoursFixed } from './hours';

export const REPORT_KINDS = ['person', 'project', 'week'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const isReportKind = (text: string): text is ReportKind =>
  (REPORT_KINDS as readonly string[]).includes(text);

/** One group of hours in one week state, as the database sums it. */
export interface ReportRow {
  /** The grouping columns, in the report's order. */
  keys: readonly string[];
  state: string;
  hundredths: number;
}

const HEADERS: Record<ReportKind, readonly string[]> = {
  person: ['Person', 'Email', 'State', 'Hours'],
  project: ['Client', 'Project', 'Project Number', 'State', 'Hours'],
  week: ['Week Start', 'State', 'Hours'],
};

export function reportCsv(kind: ReportKind, rows: readonly ReportRow[]): string {
  return encodeCsv([
    HEADERS[kind],
    ...rows.map((r) => [...r.keys, r.state, formatHoursFixed(r.hundredths)]),
  ]);
}
