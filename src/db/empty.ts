// Whether this database has an owner yet: no audit event and no admin grant. The bootstrap file guards every
// statement with it (SEC-29), and the first-admin claim is refused unless it holds.

export const EMPTY = `NOT EXISTS (SELECT 1 FROM audit_event)
AND NOT EXISTS (SELECT 1 FROM person_role WHERE role = 'admin')`;

const CHECK = `SELECT ${EMPTY} AS empty`;

/** True when no audit event and no admin grant exist: one existence check, no client rows read. */
export async function instanceEmpty(db: D1Database): Promise<boolean> {
  const row = await db.prepare(CHECK).first<{ empty: number }>();
  return row?.empty === 1;
}
