// SQL text that issues an admin a new 24-hour enrolment link when no admin can sign in, one statement per line,
// for `wrangler d1 execute --file`. scripts/rescue.ts writes the file; the one request path that runs the same
// statements is the setup claim, only for the sole admin with no passkey, no linked identity and the SETUP_TOKEN (ADR 0003).
//
// The file is for a deployment where no admin can sign in: the bootstrap link expired unused, or the only admin
// lost every passkey and recovery code. Its first statement appends one
// `people.rescue` event onto the head the operator read, and only while the person is an active admin and no
// admin holds an unrevoked passkey. Every later statement writes only while that event exists, by its hash, and
// still no admin can sign in, so a deployment with a working admin, a moved head, or a link already used takes
// no row. As re-enrolment does, it revokes the person's sessions, unused recovery codes and other open links.
import { eventHash } from '../lib/chain.ts';
import type { Cell } from '../lib/backup-format.ts';
import { BOOTSTRAP_ENROLMENT_MS } from './bootstrap.ts';
import { literal } from './sql-text.ts';

export interface RescueInput {
  readonly personId: string;
  /** The audit head the operator read just before: its seq and hash. */
  readonly headSeq: number;
  readonly headHash: string;
  readonly enrolmentHash: string;
  readonly now: number;
}

const NO_ADMIN_SIGNS_IN = `NOT EXISTS (SELECT 1 FROM person_role r JOIN person p ON p.id = r.person_id
WHERE r.role = 'admin' AND p.offboarded_at IS NULL
AND EXISTS (SELECT 1 FROM credential c WHERE c.person_id = r.person_id AND c.revoked_at IS NULL))`;

/** The one admin the setup page may re-issue a link to: the only admin, active, with no passkey and no linked identity. */
export async function lockedOutAdmin(
  db: D1Database,
): Promise<{ id: string; email: string } | null> {
  return db
    .prepare(
      `SELECT p.id, p.email FROM person_role r JOIN person p ON p.id = r.person_id
WHERE r.role = 'admin' AND p.offboarded_at IS NULL
AND (SELECT count(*) FROM person_role WHERE role = 'admin') = 1
AND NOT EXISTS (SELECT 1 FROM credential c WHERE c.person_id = p.id AND c.revoked_at IS NULL)
AND NOT EXISTS (SELECT 1 FROM person_identity i WHERE i.person_id = p.id AND i.revoked_at IS NULL)`,
    )
    .first<{ id: string; email: string }>();
}

function q(value: Cell): string {
  return literal(value) ?? 'NULL';
}

const line = (sql: string): string => `${sql};`.replaceAll('\n', ' ');

/** The statements, in order, each guarded as the header says, and the event's hash to check it landed by. */
export async function rescueSql(
  input: RescueInput,
): Promise<{ statements: string[]; hash: string }> {
  const { now, personId } = input;
  const expiresAt = now + BOOTSTRAP_ENROLMENT_MS;
  const event = {
    seq: input.headSeq + 1,
    at: now,
    actor_id: null,
    action: 'people.rescue',
    client_id: null,
    target: `person:${personId}`,
    before_json: null,
    after_json: JSON.stringify({
      enrolment_expires_at: expiresAt,
      revoked: ['sessions', 'unused recovery codes', 'open enrolment links'],
    }),
  };
  const hash = await eventHash(input.headHash, event);
  const person = q(personId);
  const eligible = `(SELECT max(seq) FROM audit_event) = ${q(input.headSeq)}
AND EXISTS (SELECT 1 FROM audit_event WHERE seq = ${q(input.headSeq)} AND hash = ${q(input.headHash)})
AND EXISTS (SELECT 1 FROM person_role r JOIN person p ON p.id = r.person_id
  WHERE r.person_id = ${person} AND r.role = 'admin' AND p.offboarded_at IS NULL)
AND ${NO_ADMIN_SIGNS_IN}`;
  const ours = `EXISTS (SELECT 1 FROM audit_event WHERE hash = ${q(hash)}) AND ${NO_ADMIN_SIGNS_IN}`;
  const values: Cell[] = [
    event.seq,
    event.at,
    event.actor_id,
    event.action,
    event.client_id,
    event.target,
    event.before_json,
    event.after_json,
    input.headHash,
    hash,
  ];
  const link = q(input.enrolmentHash);
  return {
    hash,
    statements: [
      line(`INSERT INTO audit_event (seq, at, actor_id, action, client_id, target, before_json, after_json, prev_hash, hash)
SELECT ${values.map(q).join(', ')} WHERE ${eligible}`),
      line(`UPDATE session SET revoked_at = ${q(now)}
WHERE person_id = ${person} AND revoked_at IS NULL AND ${ours}`),
      line(`UPDATE recovery_code SET used_at = ${q(now)}
WHERE person_id = ${person} AND used_at IS NULL AND ${ours}`),
      line(`UPDATE enrolment SET used_at = ${q(now)}
WHERE person_id = ${person} AND used_at IS NULL AND token_hash <> ${link} AND ${ours}`),
      line(`INSERT INTO enrolment (token_hash, person_id, expires_at)
SELECT ${link}, ${person}, ${q(expiresAt)}
WHERE ${ours} AND NOT EXISTS (SELECT 1 FROM enrolment WHERE token_hash = ${link})`),
    ],
  };
}

/** Runs the rescue for the locked-out admin onto the audit head as it stands; true only if the new link was written. */
export async function reissueLink(
  db: D1Database,
  personId: string,
  enrolmentHash: string,
  now: number,
): Promise<boolean> {
  const head = await db
    .prepare('SELECT seq, hash FROM audit_event ORDER BY seq DESC LIMIT 1')
    .first<{ seq: number; hash: string }>();
  if (head === null) return false;
  const { statements } = await rescueSql({
    personId,
    headSeq: head.seq,
    headHash: head.hash,
    enrolmentHash,
    now,
  });
  const results = await db.batch(statements.map((sql) => db.prepare(sql)));
  return results.at(-1)?.meta.changes === 1;
}
