// Test-only reads and writes on the agent tables and the rows beside them that the agent tests need.

type Row = Record<string, unknown>;

/** Every row of an agent table, or of the audit log. */
export async function rowsOf(
  db: D1Database,
  table: 'agent_grant' | 'agent_token' | 'audit_event',
): Promise<Row[]> {
  return (await db.prepare(`SELECT * FROM ${table}`).all<Row>()).results;
}

/** Moves every grant of a person's end to `at`. */
export async function endGrantsOf(db: D1Database, personId: string, at: number): Promise<void> {
  await db
    .prepare('UPDATE agent_grant SET expires_at = ?2 WHERE person_id = ?1')
    .bind(personId, at)
    .run();
}

/** Overwrites the stored return reason of a person's weeks, as a reason longer than the form allows would be. */
export async function setReturnReasons(
  db: D1Database,
  personId: string,
  reason: string,
): Promise<void> {
  await db
    .prepare('UPDATE week_submission SET return_reason = ?1 WHERE person_id = ?2')
    .bind(reason, personId)
    .run();
}

/** Removes every assignment of a person, as an admin would one by one. */
export async function dropAssignments(db: D1Database, personId: string): Promise<void> {
  await db.prepare('DELETE FROM assignment WHERE person_id = ?1').bind(personId).run();
}
