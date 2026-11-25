// The rule that at least one admin who can sign in always remains, as a read for a clear error and as SQL the
// write repeats, so a race cannot remove the last one. An admin counts only while not offboarded and holding an
// unrevoked passkey: a granted admin who never enrolled cannot sign in to issue anyone a link (ADR 0003).
import { ADMIN_GRANT, grantsOf } from './roles';

/** An admin other than ?1, not offboarded, with an unrevoked passkey; `r` is the grant row. */
export const OTHER_SIGNED_IN_ADMIN = `r.role = 'admin' AND r.person_id <> ?1
AND EXISTS (SELECT 1 FROM person p WHERE p.id = r.person_id AND p.offboarded_at IS NULL)
AND EXISTS (SELECT 1 FROM credential c WHERE c.person_id = r.person_id AND c.revoked_at IS NULL)`;

/** The same for a statement whose person is ?2. */
export const OTHER_SIGNED_IN_ADMIN_OF_2 = OTHER_SIGNED_IN_ADMIN.replaceAll('?1', '?2');

const OTHER_ADMINS = `SELECT count(*) AS n FROM person_role r WHERE ${OTHER_SIGNED_IN_ADMIN}`;

const OFFBOARD = `UPDATE person SET offboarded_at = ?2 WHERE id = ?1 AND offboarded_at IS NULL
AND (NOT EXISTS (SELECT 1 FROM person_role WHERE person_id = ?1 AND role = 'admin')
  OR EXISTS (SELECT 1 FROM person_role r WHERE ${OTHER_SIGNED_IN_ADMIN}))`;

/** The admins other than `personId` who can sign in: not offboarded, with an unrevoked passkey. */
export async function otherAdmins(db: D1Database, personId: string): Promise<number> {
  return (await db.prepare(OTHER_ADMINS).bind(personId).first<{ n: number }>())?.n ?? 0;
}

/** Whether `personId` is an admin whom no other admin who can sign in would replace. */
export async function isLastAdmin(db: D1Database, personId: string): Promise<boolean> {
  const admin = (await grantsOf(db, personId)).includes(ADMIN_GRANT);
  return admin && (await otherAdmins(db, personId)) === 0;
}

/** Stamps a person offboarded; changes nothing for the last admin who can sign in, which rolls the batch back. */
export function offboardStatement(
  db: D1Database,
  personId: string,
  now: number,
): D1PreparedStatement {
  return db.prepare(OFFBOARD).bind(personId, now);
}
