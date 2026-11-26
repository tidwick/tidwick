// What a report reads: hours in a range summed by person, client, project, task or week and by the state of the person's week
// (`draft` when no submission exists). All-clients scope only.
import { fail } from '../lib/errors';
import type { DateRange } from '../lib/date-range';
import type { ReportKind, ReportRow } from '../lib/report';
import type { Scope } from './scope';

const DAY = "date(r.week_start, '+' || e.dow || ' days')";

const STATE = "coalesce(s.state, 'draft')";

const from = (joins: string): string => `FROM entry e
JOIN week_row r ON r.client_id = e.client_id AND r.id = e.row_id
LEFT JOIN week_submission s ON s.person_id = r.person_id AND s.week_start = r.week_start
${joins}
WHERE ${DAY} BETWEEN ?1 AND ?2 AND e.hundredths > 0`;

const QUERIES: Record<ReportKind, string> = {
  person: `SELECT p.name AS k1, p.email AS k2, ${STATE} AS state, sum(e.hundredths) AS hundredths
    ${from('JOIN person p ON p.id = r.person_id')}
    GROUP BY p.id, p.name, p.email, state ORDER BY p.name, p.id, state`,
  client: `SELECT c.name AS k1, ${STATE} AS state, sum(e.hundredths) AS hundredths
    ${from('JOIN client c ON c.id = r.client_id')}
    GROUP BY c.id, c.name, state ORDER BY c.name, c.id, state`,
  project: `SELECT c.name AS k1, pr.name AS k2, coalesce(pr.number, '') AS k3, ${STATE} AS state,
      sum(e.hundredths) AS hundredths
    ${from(`JOIN project pr ON pr.client_id = r.client_id AND pr.id = r.project_id
    JOIN client c ON c.id = r.client_id`)}
    GROUP BY pr.client_id, pr.id, c.name, pr.name, pr.number, state ORDER BY c.name, pr.name, pr.id, state`,
  task: `SELECT t.code AS k1, t.name AS k2, ${STATE} AS state, sum(e.hundredths) AS hundredths
    ${from('JOIN task_code t ON t.id = r.task_code_id')}
    GROUP BY t.id, t.code, t.name, state ORDER BY t.code, t.id, state`,
  week: `SELECT r.week_start AS k1, ${STATE} AS state, sum(e.hundredths) AS hundredths
    ${from('')}
    GROUP BY r.week_start, state ORDER BY r.week_start, state`,
};

interface Record3 {
  k1: string;
  k2?: string;
  k3?: string;
  state: string;
  hundredths: number;
}

export async function reportRows(
  scope: Scope,
  db: D1Database,
  kind: ReportKind,
  range: DateRange,
): Promise<ReportRow[]> {
  if (scope.kind !== 'all') fail('forbidden');
  const found = await db.prepare(QUERIES[kind]).bind(range.from, range.to).all<Record3>();
  return found.results.map((r) => ({
    keys: [r.k1, r.k2, r.k3].filter((k): k is string => k !== undefined),
    state: r.state,
    hundredths: r.hundredths,
  }));
}
