// Test-only reads and writes on pending_codes that the expiry and pruning tests need.

export async function pendingRowPeople(db: D1Database): Promise<string[]> {
  const rows = await db.prepare('SELECT person_id FROM pending_codes').all<{ person_id: string }>();
  return rows.results.map((r) => r.person_id);
}

export async function expireAllPending(db: D1Database, at: number): Promise<void> {
  await db.prepare('UPDATE pending_codes SET expires_at = ?1').bind(at).run();
}
