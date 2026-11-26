// A report as a table: the database's long rows (one per group and week state) pivoted to one row per group with a
// column for each state, a total column and a total row. Pure; the chart reads the same shape.
import { keyHeads, type ReportKind, type ReportRow } from './report';
import type { WeekState } from './week';

/** The state columns in the order the table and the chart show them. */
export const REPORT_STATES: readonly WeekState[] = ['draft', 'submitted', 'returned', 'approved'];

export interface ReportLine {
  /** The grouping cells, in the report's order. */
  keys: readonly string[];
  /** Hours in hundredths by week state. */
  hundredths: Record<WeekState, number>;
  total: number;
}

export interface ReportTable {
  /** The grouping column headings. */
  heads: readonly string[];
  lines: ReportLine[];
  totals: ReportLine;
}

const empty = (keys: readonly string[]): ReportLine => ({
  keys,
  hundredths: { draft: 0, submitted: 0, returned: 0, approved: 0 },
  total: 0,
});

const add = (line: ReportLine, state: WeekState, hundredths: number): void => {
  line.hundredths[state] += hundredths;
  line.total += hundredths;
};

const sameKeys = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((key, i) => key === b[i]);

/** Rows arrive grouped (a group's states are adjacent), so a group is a run of rows with the same keys. */
export function reportTable(kind: ReportKind, rows: readonly ReportRow[]): ReportTable {
  const lines: ReportLine[] = [];
  const totals = empty([]);
  for (const row of rows) {
    const state = REPORT_STATES.find((s) => s === row.state);
    if (state === undefined) continue;
    let line = lines.at(-1);
    if (line === undefined || !sameKeys(line.keys, row.keys)) {
      line = empty(row.keys);
      lines.push(line);
    }
    add(line, state, row.hundredths);
    add(totals, state, row.hundredths);
  }
  return { heads: keyHeads(kind), lines, totals };
}
