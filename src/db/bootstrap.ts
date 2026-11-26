// The statements that create the first admin, built once as `{sql, params}`. `bootstrapSql` renders them as
// literal text, one per line, for `wrangler d1 execute --file` (scripts/bootstrap.ts); `claimInstance` binds the
// same statements for the one-time claim on `/setup`, so a form value is never spliced into SQL (ADR 0003).
//
// The statements seize nothing that already has an owner (SEC-29). The first writes audit event 1 only
// into an empty log with no admin grant. Every later statement writes only while the log holds exactly that
// event, by its hash, and no admin grant exists; the grant goes last. So a database with any audit event or
// any admin, and a second run of the same statements, take no row.
import { eventHash, GENESIS } from '../lib/chain.ts';
import type { Cell } from '../lib/backup-format.ts';
import { fail } from '../lib/errors.ts';
import type { WrappedKey } from '../lib/note-crypto.ts';
import { EMPTY } from './empty.ts';
import type { Scope } from './scope.ts';
import { hex, literal } from './sql-text.ts';

/** Fixed: the first admin's link is made by a CLI that reads no deploy variable; it matches the `ENROLMENT_HOURS` default. */
export const BOOTSTRAP_ENROLMENT_MS = 24 * 60 * 60 * 1000;

export interface BootstrapInput {
  readonly email: string;
  readonly name: string;
  readonly firm: string;
  readonly personId: string;
  readonly firmId: string;
  readonly clientId: string;
  readonly key: WrappedKey;
  readonly enrolmentHash: string;
  readonly now: number;
}

type Param = string | number | null | Uint8Array;

interface Statement {
  readonly sql: string;
  readonly params: readonly Param[];
}

/** Why the email, name or firm cannot start an instance, or null when all three can. */
export function bootstrapRefusal(email: string, name: string, firm: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return `"${email}" is not an email address`;
  for (const [label, value] of [
    ['name', name],
    ['firm', firm],
  ] as const) {
    if (value.trim() === '' || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) {
      return `the ${label} must be 1 to 200 printable characters`;
    }
  }
  return null;
}

/** The statements, in order, each guarded as the header says. */
async function statements(input: BootstrapInput): Promise<Statement[]> {
  const { now } = input;
  const expiresAt = now + BOOTSTRAP_ENROLMENT_MS;
  const event = {
    seq: 1,
    at: now,
    actor_id: null,
    action: 'instance.bootstrap',
    client_id: null,
    target: `person:${input.personId}`,
    before_json: null,
    after_json: JSON.stringify({
      email: input.email,
      name: input.name,
      firm: input.firm,
      firm_id: input.firmId,
      client_id: input.clientId,
      role: 'admin',
      enrolment_expires_at: expiresAt,
    }),
  };
  const hash = await eventHash(GENESIS, event);
  const rows: [string, Param[]][] = [
    ['client (id, name, created_at)', [input.clientId, input.firm, now]],
    [
      'client_key (client_id, version, wrapped, iv, kek_id, created_at)',
      [input.clientId, 1, input.key.wrapped, input.key.iv, input.key.kekId, now],
    ],
    ['firm (id, client_id)', [input.firmId, input.clientId]],
    [
      'person (id, firm_id, email, name, created_at)',
      [input.personId, input.firmId, input.email, input.name, now],
    ],
    [
      'enrolment (token_hash, person_id, expires_at)',
      [input.enrolmentHash, input.personId, expiresAt],
    ],
    ['person_role (person_id, role, granted_at)', [input.personId, 'admin', now]],
  ];
  const first: Param[] = [
    event.seq,
    event.at,
    event.actor_id,
    event.action,
    event.client_id,
    event.target,
    event.before_json,
    event.after_json,
    GENESIS,
    hash,
  ];
  const insert = (
    target: string,
    guard: string,
    values: Param[],
    bound: Param[] = [],
  ): Statement => ({
    sql: `INSERT INTO ${target} SELECT ${values.map((_, i) => `?${String(i + 1)}`).join(', ')} WHERE ${guard};`.replaceAll(
      '\n',
      ' ',
    ),
    params: [...values, ...bound],
  });
  const ours = (at: number): string => `(SELECT count(*) FROM audit_event) = 1
AND EXISTS (SELECT 1 FROM audit_event WHERE seq = 1 AND hash = ?${String(at)})
AND NOT EXISTS (SELECT 1 FROM person_role WHERE role = 'admin')`;
  return [
    insert(
      'audit_event (seq, at, actor_id, action, client_id, target, before_json, after_json, prev_hash, hash)',
      EMPTY,
      first,
    ),
    ...rows.map(([target, values]) => insert(target, ours(values.length + 1), values, [hash])),
  ];
}

function cell(value: Param): Cell {
  return value instanceof Uint8Array ? { x: hex(value) } : value;
}

/** The statements as one SQL line each, every value a literal, for a file `wrangler d1 execute` runs. */
export async function bootstrapSql(input: BootstrapInput): Promise<string[]> {
  return (await statements(input)).map(({ sql, params }) =>
    sql.replace(
      /\?(\d+)/g,
      (_, n: string) => literal(cell(params[Number(n) - 1] ?? null)) ?? 'NULL',
    ),
  );
}

/**
 * Creates the first admin from the web, once: only a ceremony scope with no person behind it may call it. The
 * statements run as one batch with every value bound, and the last one, the admin grant, writes only if every
 * guard held. True when this call made the admin, false when the instance already had an owner.
 */
export async function claimInstance(
  scope: Scope,
  db: D1Database,
  input: BootstrapInput,
): Promise<boolean> {
  if (scope.kind !== 'ceremony' || scope.actorId !== null) fail('forbidden');
  const results = await db.batch(
    (await statements(input)).map(({ sql, params }) => db.prepare(sql).bind(...params)),
  );
  return results.at(-1)?.meta.changes === 1;
}
