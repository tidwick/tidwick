// The chain check an accounting admin runs on demand from the audit page: the same walk the 09:00 check and the
// restore make, bounded by what one request may ask D1.
import { D1_QUERIES_PER_INVOCATION } from '../lib/limits';
import { fail } from '../lib/errors';
import { checkChain, hashAt } from './audit';
import { latestGoodRun } from './backup-runs';
import type { Scope } from './scope';

/** The queries the request itself makes before the walk: its session, scope and grants, with room to spare. */
export const REQUEST_QUERIES = 20;

export type AuditVerdict =
  | { state: 'intact'; events: number; head: string; backupSeq: number | null }
  | { state: 'diverged'; seq: number }
  | { state: 'broken'; seq: number }
  | { state: 'unfinished'; from: number };

/**
 * Recomputes every event's hash, then compares the log with the head the last good backup recorded. `broken` names the
 * first seq that does not follow; `diverged` the backup's head, which the log no longer holds (a log rewritten end to
 * end still chains, only the backup shows it); `unfinished` the first seq unread. `intact` carries the seq the backup
 * vouches for, or null when no backup has run yet.
 */
export async function verifyAudit(
  scope: Scope,
  db: D1Database,
  budget: number = D1_QUERIES_PER_INVOCATION,
): Promise<AuditVerdict> {
  if (scope.kind !== 'all') fail('forbidden');
  const chain = await checkChain(db, budget - REQUEST_QUERIES);
  if ('unreadFrom' in chain) return { state: 'unfinished', from: chain.unreadFrom };
  if (!chain.ok) return { state: 'broken', seq: chain.brokenSeq };
  const run = await latestGoodRun(db);
  if (run !== null && (await hashAt(db, run.chain_seq)) !== run.chain_head) {
    return { state: 'diverged', seq: run.chain_seq };
  }
  return {
    state: 'intact',
    events: chain.head.seq,
    head: chain.head.hash,
    backupSeq: run?.chain_seq ?? null,
  };
}
