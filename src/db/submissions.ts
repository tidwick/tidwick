// Moving a week through the submission table: each change is a compare-and-set on the state it read, in one batch
// with its audit event, so of two people deciding the same week only one lands and only its event is written.
import { fail } from '../lib/errors';
import type { Fingerprint } from '../lib/fingerprint';
import { ON_BEHALF_FROM, transition, type SubmissionEvent } from '../lib/submission';
import type { WeekState } from '../lib/week';
import { auditedBatch, retryOnce } from './audit';
import type { Scope } from './scope';
import { FINGERPRINT, weekFingerprint } from './week-print';
import { weekState } from './week-view';

// One parameter layout serves every statement: ?1 person, ?2 week, ?3 new state, ?4 who decides (null for a
// submit), ?5 now, ?6 the state read, ?7 the return reason, ?8 to ?10 the fingerprint the caller saw (all null for
// none). The fingerprint check sits in the statement's own WHERE, so it and the write are one statement: an edit
// cannot slip in between.
const UNCHANGED = `(?8 IS NULL OR (?8, ?9, ?10) = (${FINGERPRINT}))`;

// An approval of a draft or returned week is an approver's, on behalf of a person who has left: it needs the
// person to be offboarded, whatever the transition read.
const OFFBOARDED = 'EXISTS (SELECT 1 FROM person WHERE id = ?1 AND offboarded_at IS NOT NULL)';

const OPEN = `INSERT INTO week_submission (person_id, week_start, state, submitted_at, decided_by, decided_at)
SELECT ?1, ?2, ?3, ?5, ?4, CASE WHEN ?4 IS NULL THEN NULL ELSE ?5 END
WHERE ?6 = 'draft' AND (?4 IS NULL OR ${OFFBOARDED}) AND ${UNCHANGED}`;

const RESUBMIT = `UPDATE week_submission SET state = ?3, submitted_at = ?5, decided_by = NULL, decided_at = NULL, return_reason = NULL
WHERE person_id = ?1 AND week_start = ?2 AND state = ?6 AND ${UNCHANGED}`;

const DECIDE = `UPDATE week_submission SET state = ?3, decided_by = ?4, decided_at = ?5, return_reason = ?7
WHERE person_id = ?1 AND week_start = ?2 AND state = ?6 AND (?6 = 'submitted' OR ?6 = 'approved' OR ${OFFBOARDED}) AND ${UNCHANGED}`;

export const weekTarget = (personId: string, weekStart: string): string =>
  `week:${personId}:${weekStart}`;

export { weekFingerprint };
export type { Fingerprint };

/** What a move carries besides the event: the week the caller saw, and the approver's words for a return. */
interface Guard {
  unchanged?: Fingerprint | null;
  reason?: string | null;
}

const isOffboarded = async (db: D1Database, personId: string): Promise<boolean> =>
  (await db
    .prepare('SELECT 1 AS gone FROM person WHERE id = ?1 AND offboarded_at IS NOT NULL')
    .bind(personId)
    .first()) !== null;

async function move(
  scope: Scope,
  db: D1Database,
  personId: string,
  weekStart: string,
  event: SubmissionEvent,
  now: number,
  guard: Guard = {},
): Promise<WeekState> {
  return retryOnce(async () => {
    const from = await weekState(scope, db, personId, weekStart);
    // An approver's approval of a draft or returned week is for a person who has left, and the event says so.
    const onBehalf =
      event === 'approve' && ON_BEHALF_FROM.includes(from) && (await isOffboarded(db, personId));
    const to = onBehalf ? 'approved' : transition(from, event);
    const seen = guard.unchanged ?? null;
    const args = [
      personId,
      weekStart,
      to,
      event === 'submit' ? null : scope.actorId,
      now,
      from,
      event === 'return' ? (guard.reason ?? null) : null,
      seen?.n ?? null,
      seen?.total ?? null,
      seen?.latest ?? null,
    ];
    const statement =
      from === 'draft'
        ? db.prepare(OPEN).bind(...args)
        : to === 'submitted'
          ? db.prepare(RESUBMIT).bind(...args)
          : db.prepare(DECIDE).bind(...args);
    const after: Record<string, unknown> = { state: to };
    if (event === 'return' && guard.reason) after.reason = guard.reason;
    if (onBehalf) after.onBehalf = true;
    const batch = await auditedBatch(scope, db);
    await batch.record(
      statement,
      {
        at: now,
        action: `submission.${event}`,
        clientId: null,
        target: weekTarget(personId, weekStart),
        before: { state: from },
        after,
      },
      1,
    );
    await batch.run();
    return to;
  });
}

/**
 * The owner submits their own week; after this it is locked to them until it is returned. Given the fingerprint
 * the owner confirmed, the week is submitted only if its entries still have it, else the write is a `conflict`.
 */
export async function submitWeek(
  scope: Scope,
  db: D1Database,
  weekStart: string,
  now: number,
  unchanged: Fingerprint | null = null,
): Promise<WeekState> {
  if (scope.kind === 'ceremony') fail('forbidden');
  const personId = scope.actorId ?? fail('forbidden');
  return move(scope, db, personId, weekStart, 'submit', now, { unchanged });
}

/**
 * An accounting admin approves or returns a person's week; a member's scope never reaches this. Given the
 * fingerprint the approver read, the decision lands only while the week still has it, else it is a `conflict`.
 * A return carries the reason the owner will read, if any. Approving the draft or returned week of an offboarded person
 * is allowed, on their behalf, and the audit event says so.
 */
export async function decideWeek(
  scope: Scope,
  db: D1Database,
  personId: string,
  weekStart: string,
  event: 'approve' | 'return',
  now: number,
  guard: Guard = {},
): Promise<WeekState> {
  if (scope.kind !== 'all' || scope.actorId === null) fail('forbidden');
  return move(scope, db, personId, weekStart, event, now, guard);
}
