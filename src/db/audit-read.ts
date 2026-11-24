// What the audit page reads: events newest first by keyset page, narrowed by date, actor, client, action and
// target, each with the actor's and client's names. All-clients scope only: the log holds every client's events.
import type { AuditFilter } from '../lib/audit-filter';
import { fail } from '../lib/errors';
import type { Scope } from './scope';

/** Events on one page of the audit view. */
export const AUDIT_PAGE = 50;

const DAY_MS = 86_400_000;

export interface AuditEntry {
  seq: number;
  at: number;
  actor_id: string | null;
  /** Null for an event no person made, or a person since removed from the table. */
  actor_name: string | null;
  action: string;
  client_id: string | null;
  client_name: string | null;
  target: string;
  before_json: string | null;
  after_json: string | null;
}

export interface AuditPage {
  events: AuditEntry[];
  /** The seq to pass as the cursor for the next, older page; null on the last page. */
  next: number | null;
}

// The action and target match on their leading text with substr, so a `%` or `_` typed in a filter is only itself.
const PAGE = `SELECT a.seq, a.at, a.actor_id, p.name AS actor_name, a.action, a.client_id, c.name AS client_name,
  a.target, a.before_json, a.after_json
FROM audit_event a
LEFT JOIN person p ON p.id = a.actor_id
LEFT JOIN client c ON c.id = a.client_id
WHERE (?1 IS NULL OR a.seq < ?1)
  AND (?2 IS NULL OR a.at >= ?2)
  AND (?3 IS NULL OR a.at < ?3)
  AND (?4 IS NULL OR a.actor_id = ?4 OR (?4 = 'system' AND a.actor_id IS NULL))
  AND (?5 IS NULL OR a.client_id = ?5)
  AND (?6 IS NULL OR substr(a.action, 1, length(?6)) = ?6)
  AND (?7 IS NULL OR substr(a.target, 1, length(?7)) = ?7)
ORDER BY a.seq DESC
LIMIT ?8`;

const PEOPLE = 'SELECT id, name FROM person ORDER BY name COLLATE NOCASE, id';
const CLIENTS = 'SELECT id, name FROM client ORDER BY name COLLATE NOCASE, id';

const startOf = (date: string | null): number | null =>
  date === null ? null : Date.parse(`${date}T00:00:00Z`);

/** One page of events older than `before` (the newest when null) that match the filter, newest first. */
export async function readAuditPage(
  scope: Scope,
  db: D1Database,
  filter: AuditFilter,
  before: number | null,
): Promise<AuditPage> {
  if (scope.kind !== 'all') fail('forbidden');
  const until = startOf(filter.to);
  const found = await db
    .prepare(PAGE)
    .bind(
      before,
      startOf(filter.from),
      until === null ? null : until + DAY_MS,
      filter.actor,
      filter.client,
      filter.action,
      filter.target,
      AUDIT_PAGE + 1,
    )
    .all<AuditEntry>();
  const events = found.results.slice(0, AUDIT_PAGE);
  const last = events.at(-1);
  return { events, next: found.results.length > AUDIT_PAGE && last ? last.seq : null };
}

export interface AuditChoices {
  people: { id: string; name: string }[];
  clients: { id: string; name: string }[];
}

/** Every person and client by name, for the actor and client filters; offboarded people are in the log too. */
export async function auditChoices(scope: Scope, db: D1Database): Promise<AuditChoices> {
  if (scope.kind !== 'all') fail('forbidden');
  const [people, clients] = await db.batch<{ id: string; name: string }>([
    db.prepare(PEOPLE),
    db.prepare(CLIENTS),
  ]);
  return { people: people?.results ?? [], clients: clients?.results ?? [] };
}
