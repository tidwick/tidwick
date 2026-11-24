// The audit page's filters and page cursor, read from its address so a filtered view can be linked and refreshed.
import { weekdayOf } from './week';

export interface AuditFilter {
  /** Civil dates, UTC, both ends included. */
  from: string | null;
  to: string | null;
  /** A person id, or `system` for the events no person made (Cron, bootstrap). */
  actor: string | null;
  client: string | null;
  /** The leading text of the action or the target, such as `settings.` or `client:`. */
  action: string | null;
  target: string | null;
}

export interface AuditQuery {
  filter: AuditFilter;
  /** Show events older than this seq; null for the newest page. */
  before: number | null;
  /** What was wrong with the address, for the page to say; the bad part is left out of the filter. */
  problem: string | null;
}

/** The longest text a filter matches on, which is longer than any action name or target the app writes. */
export const FILTER_CHARS = 100;
/** The address parameters that make up the page, in the order the next-page link writes them. */
const KEYS = ['from', 'to', 'actor', 'client', 'action', 'target'] as const;

function text(params: URLSearchParams, key: string): string | null {
  const value = (params.get(key) ?? '').trim().slice(0, FILTER_CHARS);
  return value === '' ? null : value;
}

function cursor(params: URLSearchParams): number | null {
  const value = Number(params.get('before'));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** The filters and cursor an address holds. */
export function auditQuery(params: URLSearchParams): AuditQuery {
  const filter: AuditFilter = {
    from: text(params, 'from'),
    to: text(params, 'to'),
    actor: text(params, 'actor'),
    client: text(params, 'client'),
    action: text(params, 'action'),
    target: text(params, 'target'),
  };
  const dates = [filter.from, filter.to].filter((d) => d !== null);
  const real = dates.every((date) => weekdayOf(date) !== null);
  const ordered = filter.from === null || filter.to === null || filter.from <= filter.to;
  let problem: string | null = null;
  if (!real) problem = 'A date filter is not a real date; dates are YYYY-MM-DD.';
  else if (!ordered) problem = 'The start date is after the end date.';
  if (problem !== null) {
    filter.from = null;
    filter.to = null;
  }
  return { filter, before: cursor(params), problem };
}

/** The filter parameters of an address and nothing else, so a link made from it carries no cursor or posted action. */
export function filterQuery(params: URLSearchParams): URLSearchParams {
  const kept = new URLSearchParams();
  for (const key of KEYS) {
    const value = text(params, key);
    if (value !== null) kept.set(key, value);
  }
  return kept;
}

/** The query string of the page of events older than `seq`, with the same filters. */
export function nextPageQuery(params: URLSearchParams, seq: number): string {
  const next = filterQuery(params);
  next.set('before', String(seq));
  return next.toString();
}
