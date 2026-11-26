// Who decided a week and when, and why it came back: what the approver's page and the owner's page say about a
// week that has been approved or returned.
import { requirePersonVisible, type Scope } from './scope';

export interface WeekDecision {
  /** The approver's name, or null for a week no one has decided. */
  by: string | null;
  at: number | null;
  /** The reason a returned week was returned with, if the approver gave one. */
  reason: string | null;
}

const DECISION = `SELECT d.name AS by, s.decided_at AS at, s.return_reason AS reason
FROM week_submission s LEFT JOIN person d ON d.id = s.decided_by
WHERE s.person_id = ?1 AND s.week_start = ?2`;

export async function weekDecision(
  scope: Scope,
  db: D1Database,
  personId: string,
  weekStart: string,
): Promise<WeekDecision> {
  requirePersonVisible(scope, personId);
  const row = await db.prepare(DECISION).bind(personId, weekStart).first<WeekDecision>();
  return row ?? { by: null, at: null, reason: null };
}
