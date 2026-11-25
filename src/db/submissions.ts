// Moving a week through the submission table: each change is a compare-and-set on the state it read, in one batch
// with its audit event, so of two people deciding the same week only one lands and only its event is written.
import { fail } from '../lib/errors';
import { transition, type SubmissionEvent } from '../lib/submission';
import type { WeekState } from '../lib/week';
import { auditedBatch, retryOnce } from './audit';
import { requirePersonVisible, type Scope } from './scope';
import { weekState } from './week-view';

// A submit may carry the fingerprint of the week it was confirmed against (?5 to ?7, all null for none). The check
// sits in the statement's own WHERE, so it and the write are one statement: an edit cannot slip in between.
const FINGERPRINT = `SELECT count(*) AS n, coalesce(sum(e.hundredths), 0) AS total, coalesce(max(e.updated_at), 0) AS latest
FROM entry e JOIN week_row r ON r.client_id = e.client_id AND r.id = e.row_id
WHERE r.person_id = ?1 AND r.week_start = ?2`;

const UNCHANGED = `(?5 IS NULL OR (?5, ?6, ?7) = (${FINGERPRINT}))`;

const OPEN = `INSERT INTO week_submission (person_id, week_start, state, submitted_at)
SELECT ?1, ?2, 'submitted', ?3 WHERE ?4 = 'draft' AND ${UNCHANGED}`;

const RESUBMIT = `UPDATE week_submission SET state = 'submitted', submitted_at = ?3, decided_by = NULL, decided_at = NULL
WHERE person_id = ?1 AND week_start = ?2 AND state = ?4 AND ${UNCHANGED}`;

const DECIDE = `UPDATE week_submission SET state = ?3, decided_by = ?4, decided_at = ?5
WHERE person_id = ?1 AND week_start = ?2 AND state = ?6`;

export const weekTarget = (personId: string, weekStart: string): string =>
  `week:${personId}:${weekStart}`;

/** The week's entries as a person would see them change: how many, their hundredths in all, and the newest edit. */
export interface Fingerprint {
  n: number;
  total: number;
  latest: number;
}

/** The week's fingerprint now; `submitWeek` given one submits only while it still holds. */
export async function weekFingerprint(
  scope: Scope,
  db: D1Database,
  personId: string,
  weekStart: string,
): Promise<Fingerprint> {
  requirePersonVisible(scope, personId);
  const row = await db.prepare(FINGERPRINT).bind(personId, weekStart).first<Fingerprint>();
  return row ?? { n: 0, total: 0, latest: 0 };
}

async function move(
  scope: Scope,
  db: D1Database,
  personId: string,
  weekStart: string,
  event: SubmissionEvent,
  now: number,
  unchanged: Fingerprint | null = null,
): Promise<WeekState> {
  return retryOnce(async () => {
    const from = await weekState(scope, db, personId, weekStart);
    const to = transition(from, event);
    const guard = [unchanged?.n ?? null, unchanged?.total ?? null, unchanged?.latest ?? null];
    const statement =
      from === 'draft'
        ? db.prepare(OPEN).bind(personId, weekStart, now, from, ...guard)
        : to === 'submitted'
          ? db.prepare(RESUBMIT).bind(personId, weekStart, now, from, ...guard)
          : db.prepare(DECIDE).bind(personId, weekStart, to, scope.actorId, now, from);
    const batch = await auditedBatch(scope, db);
    await batch.record(
      statement,
      {
        at: now,
        action: `submission.${event}`,
        clientId: null,
        target: weekTarget(personId, weekStart),
        before: { state: from },
        after: { state: to },
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
  return move(scope, db, personId, weekStart, 'submit', now, unchanged);
}

/** An accounting admin approves or returns a person's week; a member's scope never reaches this. */
export async function decideWeek(
  scope: Scope,
  db: D1Database,
  personId: string,
  weekStart: string,
  event: 'approve' | 'return',
  now: number,
): Promise<WeekState> {
  if (scope.kind !== 'all' || scope.actorId === null) fail('forbidden');
  return move(scope, db, personId, weekStart, event, now);
}
