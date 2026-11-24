// The approvals list: every submitted week, by person, with its total hours. Only an all-clients scope reads it.
import { fail } from '../lib/errors';
import { containsPattern } from '../lib/search';
import type { Scope } from './scope';

export interface SubmittedWeek {
  person_id: string;
  name: string;
  week_start: string;
  submitted_at: number;
  total: number;
}

const SUBMITTED = `SELECT s.person_id, p.name, s.week_start, s.submitted_at,
  (SELECT coalesce(sum(e.hundredths), 0) FROM week_row r
   JOIN entry e ON e.client_id = r.client_id AND e.row_id = r.id
   WHERE r.person_id = s.person_id AND r.week_start = s.week_start) AS total
FROM week_submission s JOIN person p ON p.id = s.person_id
WHERE s.state = 'submitted'
  AND (p.name LIKE ?2 ESCAPE '\\' OR p.email LIKE ?2 ESCAPE '\\' OR p.external_code LIKE ?2 ESCAPE '\\')
ORDER BY p.name, s.person_id, s.week_start
LIMIT ?1`;

/** At most this many weeks are listed at once; approving some brings the rest up. */
export const APPROVALS_PAGE = 500;

/** A search term keeps the people whose name, email or accounting code holds it as text. */
export async function submittedWeeks(
  scope: Scope,
  db: D1Database,
  term = '',
): Promise<SubmittedWeek[]> {
  if (scope.kind !== 'all') fail('not_found');
  const found = await db
    .prepare(SUBMITTED)
    .bind(APPROVALS_PAGE, containsPattern(term))
    .all<SubmittedWeek>();
  return found.results;
}
