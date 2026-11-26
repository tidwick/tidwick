// The week's fingerprint: how many entries it holds, their hundredths in all, and the newest edit. A submit or a
// decision carries the one its caller read, and the statement that writes it compares in its own WHERE.
import type { Fingerprint } from '../lib/fingerprint';
import { requirePersonVisible, type Scope } from './scope';

export const FINGERPRINT = `SELECT count(*) AS n, coalesce(sum(e.hundredths), 0) AS total, coalesce(max(e.updated_at), 0) AS latest
FROM entry e JOIN week_row r ON r.client_id = e.client_id AND r.id = e.row_id
WHERE r.person_id = ?1 AND r.week_start = ?2`;

/** The week's fingerprint now; `submitWeek` and `decideWeek` given one act only while it still holds. */
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
