// Read-only views for the people pages: how each person gets in, and what they are assigned to. People are not
// client rows, so access takes no scope; the assignment list names projects, so it needs an all-clients scope.
import { fail } from '../lib/errors';
import type { Scope } from './scope';

export interface Access {
  /** Passkeys not revoked. */
  passkeys: number;
  /** Enrolment links unused and unexpired. */
  openLinks: number;
}

const ACCESS = `SELECT p.id,
  (SELECT count(*) FROM credential c WHERE c.person_id = p.id AND c.revoked_at IS NULL) AS passkeys,
  (SELECT count(*) FROM enrolment e WHERE e.person_id = p.id AND e.used_at IS NULL AND e.expires_at > ?1) AS open_links
FROM person p`;

/** Passkeys and open links for every person, by person id. */
export async function accessByPerson(db: D1Database, now: number): Promise<Map<string, Access>> {
  const found = await db
    .prepare(ACCESS)
    .bind(now)
    .all<{ id: string; passkeys: number; open_links: number }>();
  return new Map(
    found.results.map((r) => [r.id, { passkeys: r.passkeys, openLinks: r.open_links }]),
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
