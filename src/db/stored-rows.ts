// Whole auth, audit and week tables as stored, so tests can prove what is kept and what was audited.

export type StoredTable =
  | 'audit_event'
  | 'credential'
  | 'enrolment'
  | 'recovery_code'
  | 'recovery_attempt'
  | 'auth_challenge'
  | 'session'
  | 'week_row'
  | 'entry';

const READ: Record<StoredTable, string> = {
  audit_event: 'SELECT * FROM audit_event ORDER BY seq',
  credential: 'SELECT * FROM credential',
  enrolment: 'SELECT * FROM enrolment',
  recovery_code: 'SELECT * FROM recovery_code',
  recovery_attempt: 'SELECT * FROM recovery_attempt',
  auth_challenge: 'SELECT * FROM auth_challenge',
  session: 'SELECT * FROM session',
  week_row: 'SELECT * FROM week_row',
  entry: 'SELECT * FROM entry',
};

export async function storedRows(
  db: D1Database,
  table: StoredTable,
): Promise<Record<string, unknown>[]> {
  return (await db.prepare(READ[table]).all()).results;
}
