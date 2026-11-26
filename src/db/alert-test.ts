// The newest "Send test alert", read back from its audit event, so the result outlives the page that sent it.

const LAST = `SELECT at, after_json FROM audit_event WHERE target = ?1 AND action = 'alerts.test' ORDER BY seq DESC LIMIT 1`;

/** The newest test event at `target`: when it ran and the JSON it recorded, or null when none has. */
export async function lastTestEvent(
  db: D1Database,
  target: string,
): Promise<{ at: number; after_json: string } | null> {
  return db.prepare(LAST).bind(target).first<{ at: number; after_json: string }>();
}
