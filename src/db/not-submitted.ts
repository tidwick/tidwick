// The weeks nobody has handed in: for each of a few completed weeks, the people who were on the books while it ran
// and have no submission for it, or one that was returned. The list an approver chases before the export.
import { fail } from '../lib/errors';
import { containsPattern } from '../lib/search';
import type { Scope } from './scope';

export interface MissingWeek {
  person_id: string;
  name: string;
  week_start: string;
  /** `returned`, or `draft` when no submission row exists. */
  state: 'draft' | 'returned';
}

/** A completed week and the instant it ended. */
export interface EndedWeek {
  weekStart: string;
  endsAt: number;
}

/** At most this many person-weeks are listed. */
export const NOT_SUBMITTED_PAGE = 500;

// ?3 is a search pattern over name, email and accounting code. A person counts for a week when they are not offboarded, were created before it ended, and held an assignment
// made before it ended (an assignment that was removed no longer holds, so it does not count).
const MISSING = `SELECT p.id AS person_id, p.name, json_extract(w.value, '$.weekStart') AS week_start,
  CASE WHEN s.state IS NULL THEN 'draft' ELSE s.state END AS state
FROM json_each(?1) w
JOIN person p ON p.offboarded_at IS NULL AND p.created_at < json_extract(w.value, '$.endsAt')
LEFT JOIN week_submission s ON s.person_id = p.id AND s.week_start = json_extract(w.value, '$.weekStart')
WHERE (s.state IS NULL OR s.state = 'returned')
  AND (p.name LIKE ?3 ESCAPE '\\' OR p.email LIKE ?3 ESCAPE '\\' OR p.external_code LIKE ?3 ESCAPE '\\')
  AND EXISTS (SELECT 1 FROM assignment a WHERE a.person_id = p.id AND a.assigned_at < json_extract(w.value, '$.endsAt'))
ORDER BY p.name, p.id, json_extract(w.value, '$.weekStart')
LIMIT ?2`;

/** Whether the list was cut at a page: the rows past it are not read, so the caller says "at least". */
export interface MissingList {
  weeks: MissingWeek[];
  cut: boolean;
}

export async function notSubmittedWeeks(
  scope: Scope,
  db: D1Database,
  ended: readonly EndedWeek[],
  term = '',
): Promise<MissingList> {
  if (scope.kind !== 'all') fail('not_found');
  const found = await db
    .prepare(MISSING)
    .bind(JSON.stringify(ended), NOT_SUBMITTED_PAGE + 1, containsPattern(term))
    .all<MissingWeek>();
  const weeks = found.results;
  return { weeks: weeks.slice(0, NOT_SUBMITTED_PAGE), cut: weeks.length > NOT_SUBMITTED_PAGE };
}
