// Single sign-on state that tests stage directly. Production code never imports this module.

/** Ends a flow's ten minutes, to test an expired one. */
export async function expireFlow(db: D1Database, idHash: string): Promise<void> {
  await db.prepare('UPDATE oidc_flow SET expires_at = 1 WHERE id_hash = ?1').bind(idHash).run();
}
