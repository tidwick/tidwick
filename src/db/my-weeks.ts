// The recent weeks of one person at a glance: each week's state and hours, the returned ones first, since a
// returned week is the one that waits on its owner.
import type { WeekState } from '../lib/week';
import { requirePersonVisible, type Scope } from './scope';

export interface RecentWeek {
  weekStart: string;
  state: WeekState;
  /** Hundredths of an hour in the week, over every row. */
  total: number;
}

const RECENT = `SELECT j.value AS week_start, coalesce(s.state, 'draft') AS state,
  (SELECT coalesce(sum(e.hundredths), 0) FROM week_row r
   JOIN entry e ON e.client_id = r.client_id AND e.row_id = r.id
   WHERE r.person_id = ?1 AND r.week_start = j.value) AS total
FROM json_each(?2) j LEFT JOIN week_submission s ON s.person_id = ?1 AND s.week_start = j.value`;

interface Row {
  week_start: string;
  state: WeekState;
  total: number;
}

/** `weekStarts` as given, newest first, with returned weeks moved ahead of the rest. */
export async function recentWeeks(
  scope: Scope,
  db: D1Database,
  personId: string,
  weekStarts: readonly string[],
): Promise<RecentWeek[]> {
  requirePersonVisible(scope, personId);
  const found = await db.prepare(RECENT).bind(personId, JSON.stringify(weekStarts)).all<Row>();
  const weeks = weekStarts.flatMap((weekStart) => {
    const row = found.results.find((r) => r.week_start === weekStart);
    return row ? [{ weekStart, state: row.state, total: row.total }] : [];
  });
  return [
    ...weeks.filter((w) => w.state === 'returned'),
    ...weeks.filter((w) => w.state !== 'returned'),
  ];
}
