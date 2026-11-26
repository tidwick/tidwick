// Read-only views for the people pages: how each person gets in, and what they are assigned to. People are not
// client rows, so access takes no scope; the assignment list names projects, so it needs an all-clients scope.
import { fail } from '../lib/errors';
import type { Scope } from './scope';

/** What a person with no sign-in method has. */
export const NO_ACCESS: Access = { passkeys: 0, sso: 0, openLinks: 0 };

export interface Access {
  /** Passkeys not revoked. */
  passkeys: number;
  /** Identities at identity providers not revoked. */
  sso: number;
  /** Enrolment links unused and unexpired. */
  openLinks: number;
}

const ACCESS = `SELECT p.id,
  (SELECT count(*) FROM credential c WHERE c.person_id = p.id AND c.revoked_at IS NULL) AS passkeys,
  (SELECT count(*) FROM person_identity i WHERE i.person_id = p.id AND i.revoked_at IS NULL) AS sso,
  (SELECT count(*) FROM enrolment e WHERE e.person_id = p.id AND e.used_at IS NULL AND e.expires_at > ?1) AS open_links
FROM person p`;

/** Passkeys, identities and open links for every person, by person id. */
export async function accessByPerson(db: D1Database, now: number): Promise<Map<string, Access>> {
  const found = await db
    .prepare(ACCESS)
    .bind(now)
    .all<{ id: string; passkeys: number; sso: number; open_links: number }>();
  return new Map(
    found.results.map((r) => [r.id, { passkeys: r.passkeys, sso: r.sso, openLinks: r.open_links }]),
  );
}

export interface PersonAssignment {
  project_id: string;
  project: string;
  number: string | null;
  client_id: string;
  client: string;
  assigned_at: number;
  archived: number;
}

const ASSIGNMENTS = `SELECT a.project_id, p.name AS project, p.number, c.id AS client_id, c.name AS client,
  a.assigned_at, p.archived_at IS NOT NULL AS archived
FROM assignment a
JOIN project p ON p.client_id = a.client_id AND p.id = a.project_id
JOIN client c ON c.id = a.client_id
WHERE a.person_id = ?1 ORDER BY a.assigned_at DESC, p.name`;

/** The projects a person is assigned to, newest first. */
export async function assignmentsOf(
  scope: Scope,
  db: D1Database,
  personId: string,
): Promise<PersonAssignment[]> {
  if (scope.kind !== 'all') fail('forbidden');
  return (await db.prepare(ASSIGNMENTS).bind(personId).all<PersonAssignment>()).results;
}

export interface AssignableProject {
  id: string;
  project: string;
  client: string;
}

/** Most projects the person page lists to assign one at a time; assign-to-all covers the rest. */
export const ASSIGNABLE_SHOWN = 300;

const ASSIGNABLE = `SELECT p.id, p.name AS project, c.name AS client FROM project p
JOIN client c ON c.id = p.client_id
WHERE p.archived_at IS NULL AND c.archived_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM assignment a WHERE a.project_id = p.id AND a.person_id = ?1)
ORDER BY c.name, p.name LIMIT ?2`;

/** The live projects a person is not yet assigned to, by client then name. */
export async function assignableProjects(
  scope: Scope,
  db: D1Database,
  personId: string,
): Promise<AssignableProject[]> {
  if (scope.kind !== 'all') fail('forbidden');
  return (await db.prepare(ASSIGNABLE).bind(personId, ASSIGNABLE_SHOWN).all<AssignableProject>())
    .results;
}
