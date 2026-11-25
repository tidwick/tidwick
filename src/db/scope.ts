// The caller's scope. Only this file can build a Scope, so a scoped query cannot be called without one.
import { fail } from '../lib/errors';

declare const brand: unique symbol;

interface MemberScope {
  readonly kind: 'member';
  readonly actorId: string;
  readonly projectIds: readonly string[];
}

/**
 * An MCP client acting as one person, always with member-level reach whatever roles the person holds: the assigned
 * projects and nothing else. The grant and client ride along so every audited write is marked as the agent's.
 */
interface AgentScope {
  readonly kind: 'agent';
  readonly actorId: string;
  readonly projectIds: readonly string[];
  readonly grantId: string;
  readonly client: string;
}

/** Every client's rows, explicitly: the actor is the person every write under it is audited as, null for Cron. */
interface AllScope {
  readonly kind: 'all';
  readonly actorId: string | null;
}

/** A public auth ceremony: no client rows at all, acting as the person it proves, or null before one is known. */
interface CeremonyScope {
  readonly kind: 'ceremony';
  readonly actorId: string | null;
}

type Unbranded = MemberScope | AgentScope | AllScope | CeremonyScope;

export type Scope = Unbranded & { readonly [brand]: 'Scope' };

const sealed = (scope: Unbranded): Scope => scope as Scope;

interface ScopeRow {
  offboarded_at: number | null;
  powered: number;
  project_ids: string;
}

const SCOPE_OF_PERSON = `SELECT p.offboarded_at,
  EXISTS (SELECT 1 FROM person_role r WHERE r.person_id = p.id) AS powered,
  (SELECT json_group_array(a.project_id) FROM assignment a WHERE a.person_id = p.id) AS project_ids
FROM person p WHERE p.id = ?1`;

/**
 * Builds a person's scope: an accounting admin or admin gets every client, a member gets the assigned
 * projects. Only the authz middleware calls it. An unknown or offboarded person is forbidden.
 */
export async function scopeFor(db: D1Database, personId: string): Promise<Scope> {
  const row = await db.prepare(SCOPE_OF_PERSON).bind(personId).first<ScopeRow>();
  if (!row || row.offboarded_at !== null) fail('forbidden', 'no active person');
  if (row.powered) return sealed({ kind: 'all', actorId: personId });
  const projectIds = (JSON.parse(row.project_ids) as string[]).toSorted();
  return sealed({ kind: 'member', actorId: personId, projectIds });
}

/**
 * The scope of an agent grant, built on every call so a role or assignment change applies at once. Only the
 * `/mcp` route calls it. An unknown or offboarded person is forbidden; an admin's agent still sees assigned projects only.
 */
export async function agentScopeFor(
  db: D1Database,
  grant: { id: string; person_id: string; client_name: string },
): Promise<Scope> {
  const row = await db.prepare(SCOPE_OF_PERSON).bind(grant.person_id).first<ScopeRow>();
  if (!row || row.offboarded_at !== null) fail('forbidden', 'no active person');
  const projectIds = (JSON.parse(row.project_ids) as string[]).toSorted();
  return sealed({
    kind: 'agent',
    actorId: grant.person_id,
    projectIds,
    grantId: grant.id,
    client: grant.client_name,
  });
}

/**
 * Every client's rows with no actor, for tests that write with no person behind them. No production code
 * calls it: the backup and the 09:00 check read with no Scope at all (ADR 0008).
 */
export function systemScope(): Scope {
  return sealed({ kind: 'all', actorId: null });
}

/**
 * The scope of a passkey, enrolment or recovery ceremony, which has no session yet. Only `src/auth/` calls
 * it, so its audit events carry the right actor; it reaches no client rows.
 */
export function ceremonyScope(actorId: string | null): Scope {
  return sealed({ kind: 'ceremony', actorId });
}

/** The assigned project ids as one JSON parameter for `json_each`, or null only when the scope holds every client. */
export function projectsParam(scope: Scope): string | null {
  if (scope.kind === 'all') return null;
  return JSON.stringify(scope.kind === 'member' || scope.kind === 'agent' ? scope.projectIds : []);
}

/** Only an all-clients scope reads another person's rows; any other person is a scoped miss and returns 404. */
export function requirePersonVisible(scope: Scope, personId: string): void {
  if (scope.kind !== 'all' && scope.actorId !== personId) fail('not_found');
}

/** Only an all-clients scope may call a steward or admin mutator; a member scope is refused, whatever the route table says. */
export function requireAll(scope: Scope): void {
  if (scope.kind !== 'all') fail('forbidden');
}
