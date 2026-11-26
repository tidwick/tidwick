// The only writer of audit_event, the chain check over it, and the head the backup records.
import {
  eventHash,
  GENESIS,
  verifyLinks,
  type ChainLink,
  type Head,
  type LinkVerdict,
} from '../lib/chain';
import { fail } from '../lib/errors';
import { errorText } from '../lib/error-text';
import type { AuditEvent } from './audit-actions';
import { PAGE_ROWS } from './backup-rows';
import type { Scope } from './scope';

export type AuditRow = ChainLink;
export type { Head, LinkVerdict };

/** A chain check's verdict, or the first seq it had no query left to read. */
export type ChainCheck = LinkVerdict | { ok: false; unreadFrom: number };

export interface AuditInput {
  at: number;
  action: AuditEvent;
  clientId: string | null;
  target: string;
  before?: unknown;
  after?: unknown;
}

const HEAD = 'SELECT seq, hash FROM audit_event ORDER BY seq DESC LIMIT 1';

const APPEND = `INSERT INTO audit_event
  (seq, at, actor_id, action, client_id, target, before_json, after_json, prev_hash, hash)
VALUES (CASE WHEN ?1 IS NULL OR changes() = ?1 THEN ?2 ELSE 0 END, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`;

const PAGE = `SELECT seq, at, actor_id, action, client_id, target, before_json, after_json, prev_hash, hash
FROM audit_event WHERE seq > ?1 ORDER BY seq LIMIT ?2`;

function json(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

/** An agent's write carries `via` inside the hashed `after`, so no event it causes can be told from a person's own. */
function afterOf(scope: Scope, after: unknown): unknown {
  if (scope.kind !== 'agent') return after;
  const via = { kind: 'agent', grant: scope.grantId, client: scope.client };
  const body = typeof after === 'object' && after !== null && !Array.isArray(after) ? after : {};
  return { ...body, via };
}

/** The newest event's seq and hash, or seq 0 and the genesis hash for an empty log. */
export async function readHead(db: D1Database): Promise<Head> {
  return (await db.prepare(HEAD).first<Head>()) ?? { seq: 0, hash: GENESIS };
}

/**
 * The insert for one event linked to `head`, to ride the same `db.batch` right after the statement it
 * records. With `expectedChanges` set, the event's seq becomes 0 unless that statement changed exactly
 * that many rows, so the CHECK fails and the whole batch rolls back. Returns the head after the event.
 */
export async function auditStatement(
  scope: Scope,
  db: D1Database,
  head: Head,
  input: AuditInput,
  expectedChanges: number | null,
): Promise<{ statement: D1PreparedStatement; head: Head }> {
  const link: ChainLink = {
    seq: head.seq + 1,
    at: input.at,
    actor_id: scope.actorId,
    action: input.action,
    client_id: input.clientId,
    target: input.target,
    before_json: json(input.before),
    after_json: json(afterOf(scope, input.after)),
    prev_hash: head.hash,
    hash: '',
  };
  link.hash = await eventHash(head.hash, link);
  const statement = db
    .prepare(APPEND)
    .bind(
      expectedChanges,
      link.seq,
      link.at,
      link.actor_id,
      link.action,
      link.client_id,
      link.target,
      link.before_json,
      link.after_json,
      link.prev_hash,
      link.hash,
    );
  return { statement, head: { seq: link.seq, hash: link.hash } };
}

/**
 * Appends one event that records no row change of its own, such as an export. An event that lands between its
 * head read and its insert takes that seq, so the insert retries once on a fresh head, then fails as `conflict`.
 */
export async function appendEvent(scope: Scope, db: D1Database, input: AuditInput): Promise<Head> {
  return retryOnce(async () => {
    const { statement, head } = await auditStatement(scope, db, await readHead(db), input, null);
    await statement.run();
    return head;
  });
}

const HASH_AT = 'SELECT hash FROM audit_event WHERE seq = ?1';

/** The stored hash of one event, or null when no event has that seq. */
export async function hashAt(db: D1Database, seq: number): Promise<string | null> {
  if (seq === 0) return GENESIS;
  return (await db.prepare(HASH_AT).bind(seq).first<{ hash: string }>())?.hash ?? null;
}

/**
 * Walks the log in seq order, recomputing every hash, in pages the size of the backup's, so any log the backup
 * can dump this can verify. Reports the first broken seq, or where it stopped once `maxQueries` pages are read.
 */
export async function checkChain(db: D1Database, maxQueries = Infinity): Promise<ChainCheck> {
  let head: Head = { seq: 0, hash: GENESIS };
  for (let queries = 0; ; queries++) {
    if (queries >= maxQueries) return { ok: false, unreadFrom: head.seq + 1 };
    const page = (await db.prepare(PAGE).bind(head.seq, PAGE_ROWS).all<AuditRow>()).results;
    const verdict = await verifyLinks(head, page);
    if (!verdict.ok || page.length < PAGE_ROWS) return verdict;
    head = verdict.head;
  }
}

/**
 * A batch whose every audited statement is followed by its event: `record` pairs a change with the event and
 * the row count it must have changed, `also` adds an unaudited statement, `run` sends them as one batch and
 * returns each statement's result in the order added, the events included.
 */
export interface AuditedBatch {
  record(
    statement: D1PreparedStatement,
    input: AuditInput,
    expectedChanges: number | null,
  ): Promise<void>;
  also(statement: D1PreparedStatement): void;
  run(): Promise<D1Result[]>;
}

export async function auditedBatch(scope: Scope, db: D1Database): Promise<AuditedBatch> {
  let head = await readHead(db);
  const statements: D1PreparedStatement[] = [];
  return {
    async record(statement, input, expectedChanges) {
      const event = await auditStatement(scope, db, head, input, expectedChanges);
      statements.push(statement, event.statement);
      head = event.head;
    },
    also(statement) {
      statements.push(statement);
    },
    run() {
      return db.batch(statements);
    },
  };
}

// Broad on purpose: a permanent constraint failure retries to the bound and surfaces as conflict.
const LOST_RACE = /constraint failed|audit_link/i;

/** Whether a batch rolled back because a guard saw a concurrent write: a CAS miss, a lost seq or a taken key. */
export function lostRace(error: unknown): boolean {
  return error instanceof Error && LOST_RACE.test(error.message);
}

/** A write that lost its race twice is a conflict; the log says why, since a permanent FK or CHECK failure looks the same. */
function conflict(error: unknown): never {
  console.error('tidwick: write conflict:', errorText(error));
  fail('conflict');
}

/** Runs a read-then-batch write, and once more if a concurrent writer made its batch roll back; then `conflict`. */
export async function retryOnce<T>(write: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await write();
    } catch (error) {
      if (!lostRace(error)) throw error;
      if (attempt === 1) conflict(error);
    }
  }
}

/**
 * Like `retryOnce`, for a batch that follows steps that cannot run twice (a consumed challenge, a verified
 * passkey). On a lost race `stillOpen` says whether the batch's own guard, such as an unused link, still holds:
 * if not, `gone` fails with the ceremony's error; if so the chain head moved, and the batch is rebuilt on a fresh
 * head, up to `attempts` times, then `conflict`.
 */
export async function retryWhileOpen<T>(
  write: () => Promise<T>,
  stillOpen: () => Promise<boolean>,
  gone: () => never,
  attempts = 3,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await write();
    } catch (error) {
      if (!lostRace(error)) throw error;
      if (!(await stillOpen())) gone();
      if (attempt === attempts) conflict(error);
    }
  }
}
