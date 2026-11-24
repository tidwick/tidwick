// Role grants on top of membership (ADR 0004). People are not client rows, so this takes no scope.

export const GRANTS = ['accounting_admin', 'admin'] as const;
export type Grant = (typeof GRANTS)[number];

/** The grant that owns reference data and people. */
export const ADMIN_GRANT = 'admin' satisfies Grant;

const GRANTS_OF = 'SELECT role FROM person_role WHERE person_id = ?1 ORDER BY role';

export async function grantsOf(db: D1Database, personId: string): Promise<Grant[]> {
  const { results } = await db.prepare(GRANTS_OF).bind(personId).all<{ role: Grant }>();
  return results.map((row) => row.role);
}

/** What a page may show, from grants it already read: admin-only controls, and controls for either admin grant. */
export const isAdmin = (grants: readonly Grant[]): boolean => grants.includes(ADMIN_GRANT);
export const isSteward = (grants: readonly Grant[]): boolean => grants.length > 0;
export const isAccounting = (grants: readonly Grant[]): boolean =>
  grants.includes('accounting_admin');
