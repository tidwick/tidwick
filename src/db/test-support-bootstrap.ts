// Test support for the first admin bootstrap, never imported by production code: a bootstrap file built
// as scripts/bootstrap.ts builds it, and row counts over every table so "writes nothing" means every table.
import { keyedHash, randomToken } from '../auth/tokens';
import { currentEnv } from '../lib/env';
import { newId } from '../lib/ids';
import { newClientKey } from '../lib/note-crypto';
import { bootstrapSql } from './bootstrap';
import { tableNames } from './test-support-backup';

export const BOOTSTRAP_NOW = Date.UTC(2026, 10, 2, 9);

/** A whole bootstrap file under the test secrets, and the raw enrolment token it opens. */
export async function bootstrapFile(email: string): Promise<{ sql: string; token: string }> {
  const { SESSION_SECRET, NOTE_KEK } = currentEnv();
  const clientId = newId();
  const token = randomToken();
  const statements = await bootstrapSql({
    email,
    name: 'Ada Example',
    firm: "O'Hara Example Studio",
    personId: newId(),
    firmId: newId(),
    clientId,
    key: await newClientKey(NOTE_KEK, clientId, 1),
    enrolmentHash: await keyedHash(SESSION_SECRET, 'enrol', token),
    now: BOOTSTRAP_NOW,
  });
  return { sql: statements.join('\n'), token };
}

/** Rows per table the migrations made. */
export async function rowCounts(db: D1Database): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const name of await tableNames(db)) {
    const row = await db.prepare(`SELECT count(*) AS n FROM "${name}"`).first<{ n: number }>();
    counts[name] = row?.n ?? -1;
  }
  return counts;
}

/** Every audit event's seq, action and actor, in order. */
export async function auditEvents(
  db: D1Database,
): Promise<{ seq: number; action: string; actor_id: string | null }[]> {
  const rows = await db
    .prepare('SELECT seq, action, actor_id FROM audit_event ORDER BY seq')
    .all<{ seq: number; action: string; actor_id: string | null }>();
  return rows.results;
}

export async function adminGrants(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT count(*) AS n FROM person_role WHERE role = 'admin'")
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Runs a fresh bootstrap file for a new email and returns the row counts before and after it. */
export async function seizeAttempt(
  db: D1Database,
): Promise<{ before: Record<string, number>; after: Record<string, number> }> {
  const before = await rowCounts(db);
  await db.exec((await bootstrapFile('intruder@example.test')).sql);
  return { before, after: await rowCounts(db) };
}
