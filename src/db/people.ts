// Person lookups. The auth ceremonies read one person with no scope; the listing readers need an all-clients scope.
import { containsPattern } from '../lib/search';
import { requireAll, type Scope } from './scope';

export interface PersonRow {
  id: string;
  email: string;
  name: string;
  offboarded_at: number | null;
}

export interface PersonListRow extends PersonRow {
  firm_id: string;
  firm_name: string;
  external_code: string | null;
  roles: string;
}

const BY_ID = 'SELECT id, email, name, offboarded_at FROM person WHERE id = ?1';
const BY_EMAIL = 'SELECT id, email, name, offboarded_at FROM person WHERE email = ?1';

const LIST = `SELECT p.id, p.email, p.name, p.offboarded_at, p.firm_id, f.name AS firm_name, p.external_code,
  COALESCE((SELECT group_concat(r.role, ',') FROM person_role r WHERE r.person_id = p.id), '') AS roles
FROM person p JOIN firm f ON f.id = p.firm_id
WHERE p.name LIKE ?1 ESCAPE '\\' OR p.email LIKE ?1 ESCAPE '\\' OR p.external_code LIKE ?1 ESCAPE '\\' OR f.name LIKE ?1 ESCAPE '\\'
ORDER BY p.offboarded_at IS NOT NULL, p.name`;

const DETAIL = `SELECT p.id, p.email, p.name, p.offboarded_at, p.firm_id, f.name AS firm_name, p.external_code,
  COALESCE((SELECT group_concat(r.role, ',') FROM person_role r WHERE r.person_id = p.id), '') AS roles
FROM person p JOIN firm f ON f.id = p.firm_id WHERE p.id = ?1`;

export async function personById(db: D1Database, id: string): Promise<PersonRow | null> {
  return db.prepare(BY_ID).bind(id).first<PersonRow>();
}

/** Email is UNIQUE COLLATE NOCASE, so any casing finds the person. */
export async function personByEmail(db: D1Database, email: string): Promise<PersonRow | null> {
  return db.prepare(BY_EMAIL).bind(email).first<PersonRow>();
}

/**
 * Every person, active first, with their firm and comma-joined grants. A search term keeps the people whose name,
 * email, accounting code or firm holds it as text, ignoring case for ASCII letters (SQLite's LIKE).
 */
export async function listPeople(
  scope: Scope,
  db: D1Database,
  term = '',
): Promise<PersonListRow[]> {
  requireAll(scope);
  return (await db.prepare(LIST).bind(containsPattern(term)).all<PersonListRow>()).results;
}

export async function personDetail(
  scope: Scope,
  db: D1Database,
  id: string,
): Promise<PersonListRow | null> {
  requireAll(scope);
  return db.prepare(DETAIL).bind(id).first<PersonListRow>();
}
