// Moving a week through the submission table: each change is a compare-and-set on the state it read, in one batch
// with its audit event, so of two people deciding the same week only one lands and only its event is written.
import { fail } from '../lib/errors';
import { transition, type SubmissionEvent } from '../lib/submission';
import type { WeekState } from '../lib/week';
import { auditedBatch, retryOnce } from './audit';
import type { Scope } from './scope';
import { weekState } from './week-view';

const OPEN = `INSERT INTO week_submission (person_id, week_start, state, submitted_at)
VALUES (?1, ?2, 'submitted', ?3)`;

const RESUBMIT = `UPDATE week_submission SET state = 'submitted', submitted_at = ?3, decided_by = NULL, decided_at = NULL
WHERE person_id = ?1 AND week_start = ?2 AND state = ?4`;

const DECIDE = `UPDATE week_submission SET state = ?3, decided_by = ?4, decided_at = ?5
WHERE person_id = ?1 AND week_start = ?2 AND state = ?6`;

export const weekTarget = (personId: string, weekStart: string): string =>
  `week:${personId}:${weekStart}`;

async function move(
  scope: Scope,
  db: D1Database,
  personId: string,
  weekStart: string,
  event: SubmissionEvent,
  now: number,
): Promise<WeekState> {
  return retryOnce(async () => {
    const from = await weekState(scope, db, personId, weekStart);
    const to = transition(from, event);
    const statement =
      from === 'draft'
        ? db.prepare(OPEN).bind(personId, weekStart, now)
        : to === 'submitted'
          ? db.prepare(RESUBMIT).bind(personId, weekStart, now, from)
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

/** The owner submits their own week; after this it is locked to them until it is returned. */
export async function submitWeek(
  scope: Scope,
  db: D1Database,
  weekStart: string,
  now: number,
): Promise<WeekState> {
  if (scope.kind === 'ceremony') fail('forbidden');
  const personId = scope.actorId ?? fail('forbidden');
  return move(scope, db, personId, weekStart, 'submit', now);
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
