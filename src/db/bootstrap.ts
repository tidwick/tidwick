// SQL text that creates the first admin, one statement per line, for `wrangler d1 execute --file`. Only
// scripts/bootstrap.ts uses it; no request path reaches it (ADR 0003).
//
// The file seizes nothing that already has an owner (SEC-29). Its first statement writes audit event 1 only
// into an empty log with no admin grant. Every later statement writes only while the log holds exactly that
// event, by its hash, and no admin grant exists; the grant goes last. So a database with any audit event or
// any admin, and a second run of the same file, take no row.
import { eventHash, GENESIS } from '../lib/chain.ts';
import type { Cell } from '../lib/backup-format.ts';
import type { WrappedKey } from '../lib/note-crypto.ts';
import { hex, literal } from './sql-text.ts';

/** How long the first admin's enrolment link stays open; the same as every other enrolment link. */
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

const EMPTY = `NOT EXISTS (SELECT 1 FROM audit_event)
AND NOT EXISTS (SELECT 1 FROM person_role WHERE role = 'admin')`;

function q(value: Cell): string {
  return literal(value) ?? 'NULL';
}

/** The statements, in order, each guarded as the header says. */
export async function bootstrapSql(input: BootstrapInput): Promise<string[]> {
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
  const ours = `(SELECT count(*) FROM audit_event) = 1
AND EXISTS (SELECT 1 FROM audit_event WHERE seq = 1 AND hash = ${q(hash)})
AND NOT EXISTS (SELECT 1 FROM person_role WHERE role = 'admin')`;
  const rows: [string, Cell[]][] = [
    ['client (id, name, created_at)', [input.clientId, input.firm, now]],
    [
      'client_key (client_id, version, wrapped, iv, kek_id, created_at)',
      [
        input.clientId,
        1,
        { x: hex(input.key.wrapped) },
        { x: hex(input.key.iv) },
        input.key.kekId,
        now,
      ],
    ],
    ['firm (id, name, client_id)', [input.firmId, input.firm, input.clientId]],
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
  const first: Cell[] = [
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
  const insert = (target: string, guard: string, values: Cell[]): string =>
    `INSERT INTO ${target} SELECT ${values.map(q).join(', ')} WHERE ${guard};`.replaceAll(
      '\n',
      ' ',
    );
  return [
    insert(
      'audit_event (seq, at, actor_id, action, client_id, target, before_json, after_json, prev_hash, hash)',
      EMPTY,
      first,
    ),
    ...rows.map(([target, values]) => insert(target, ours, values)),
  ];
}
