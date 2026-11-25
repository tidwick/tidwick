// What `just demo-reset` runs before migrating again and loading the demo seed: every table dropped, children
// before parents, with wrangler's migration log last so every migration applies again. A dropped table takes its
// triggers with it, so the append-only audit log goes too; that is the point of a reset, and why only the demo
// recipes run this file. `src/db/demo-reset.test.ts` proves the list leaves no table behind.

/**
 * Every table the migrations create, in an order that drops each before any table it references. The audit log
 * goes first: it names people and clients, and a database migrated before ADR 0006 still holds it to them by key.
 */
export const DROP_ORDER = [
  'audit_event',
  'entry',
  'week_row',
  'week_submission',
  'import_batch',
  'assignment',
  'project_task',
  'project',
  'task_code',
  'client_key',
  'recovery_code',
  'recovery_attempt',
  'auth_challenge',
  'agent_token',
  'agent_grant',
  'oidc_flow',
  'person_identity',
  'session',
  'enrolment',
  'credential',
  'person_role',
  'person',
  'firm',
  'client',
  'setting',
  'backup_run',
  'd1_migrations',
] as const;

export function dropStatements(): string[] {
  return DROP_ORDER.map((table) => `DROP TABLE IF EXISTS ${table};`);
}
