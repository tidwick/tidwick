// The approvals list: weeks by person with their total hours, in one state at a time and inside an optional range
// of weeks. Only an all-clients scope reads it.
import { fail } from '../lib/errors';
import { containsPattern } from '../lib/search';
import type { Scope } from './scope';

export const LISTED_STATES = ['submitted', 'approved', 'returned', 'draft'] as const;
export type ListedState = (typeof LISTED_STATES)[number];

export interface ListedWeek {
  person_id: string;
  name: string;
  /** 1 for a person who has been offboarded. */
  offboarded: number;
  week_start: string;
  /** When it was submitted, or decided for an approved or returned week; null for a draft. */
  at: number | null;
  total: number;
}

/** The weeks one list holds, and how many matched in all when that is more than a page. */
export interface Listing {
  weeks: ListedWeek[];
  found: number;
}

export interface Filter {
  state: ListedState;
  term?: string;
  /** The first and last Monday listed; null for no bound. */
  from?: string | null;
  to?: string | null;
}

const SEARCH = `(p.name LIKE ?2 ESCAPE '\\' OR p.email LIKE ?2 ESCAPE '\\' OR p.external_code LIKE ?2 ESCAPE '\\')`;
const RANGE = '(?4 IS NULL OR s.week_start >= ?4) AND (?5 IS NULL OR s.week_start <= ?5)';

// ?1 the page, ?2 the search pattern, ?3 the state, ?4 and ?5 the range. A draft is a week with entries and no
// submission row; the rest are rows of the table.
const DECIDED = `FROM week_submission s JOIN person p ON p.id = s.person_id
WHERE s.state = ?3 AND ${SEARCH} AND ${RANGE}`;
const DRAFT = `FROM (SELECT DISTINCT person_id, week_start, NULL AS submitted_at, NULL AS decided_at FROM week_row) s JOIN person p ON p.id = s.person_id
WHERE ?3 = 'draft' AND ${SEARCH} AND ${RANGE}
  AND NOT EXISTS (SELECT 1 FROM week_submission x WHERE x.person_id = s.person_id AND x.week_start = s.week_start)`;

const COLUMNS = `SELECT s.person_id, p.name, p.offboarded_at IS NOT NULL AS offboarded, s.week_start,
  CASE WHEN ?3 = 'draft' THEN NULL WHEN ?3 = 'submitted' THEN s.submitted_at ELSE coalesce(s.decided_at, s.submitted_at) END AS at,
  (SELECT coalesce(sum(e.hundredths), 0) FROM week_row r
   JOIN entry e ON e.client_id = r.client_id AND e.row_id = r.id
   WHERE r.person_id = s.person_id AND r.week_start = s.week_start) AS total`;
const ORDER = 'ORDER BY p.name, s.person_id, s.week_start';

const LIST = {
  decided: `${COLUMNS} ${DECIDED} ${ORDER} LIMIT ?1`,
  draft: `${COLUMNS} ${DRAFT} ${ORDER} LIMIT ?1`,
};
const COUNT = {
  decided: `SELECT count(*) AS n ${DECIDED}`,
  draft: `SELECT count(*) AS n ${DRAFT}`,
};

/** At most this many weeks are listed at once; deciding some, or narrowing the range, brings the rest up. */
export const APPROVALS_PAGE = 500;

/** A search term keeps the people whose name, email or accounting code holds it as text. */
export async function approvalWeeks(
  scope: Scope,
  db: D1Database,
  filter: Filter,
): Promise<Listing> {
  if (scope.kind !== 'all') fail('not_found');
  const kind = filter.state === 'draft' ? 'draft' : 'decided';
  const args = [
    containsPattern(filter.term ?? ''),
    filter.state,
    filter.from ?? null,
    filter.to ?? null,
  ];
  // One more than a page: if it comes back, the list was cut, and a count says how many there are.
  const found = await db
    .prepare(LIST[kind])
    .bind(APPROVALS_PAGE + 1, ...args)
    .all<ListedWeek>();
  if (found.results.length <= APPROVALS_PAGE) {
    return { weeks: found.results, found: found.results.length };
  }
  const count = await db
    .prepare(COUNT[kind])
    .bind(0, ...args)
    .first<{ n: number }>();
  return { weeks: found.results.slice(0, APPROVALS_PAGE), found: count?.n ?? found.results.length };
}

const NEXT = `SELECT s.person_id, s.week_start FROM week_submission s JOIN person p ON p.id = s.person_id
WHERE s.state = 'submitted' AND (p.name, s.person_id, s.week_start) > ((SELECT name FROM person WHERE id = ?1), ?1, ?2)
${ORDER} LIMIT 1`;

/** The next week waiting for a decision after this one in the list's order, or null when none follows. */
export async function nextWaiting(
  scope: Scope,
  db: D1Database,
  personId: string,
  weekStart: string,
): Promise<{ person_id: string; week_start: string } | null> {
  if (scope.kind !== 'all') fail('not_found');
  return db
    .prepare(NEXT)
    .bind(personId, weekStart)
    .first<{ person_id: string; week_start: string }>();
}
