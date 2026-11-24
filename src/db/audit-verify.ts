// The chain check an accounting admin runs on demand from the audit page: the same walk the 09:00 check and the
// restore make, bounded by what one request may ask D1.
import { D1_QUERIES_PER_INVOCATION } from '../lib/limits';
import { fail } from '../lib/errors';
import { checkChain } from './audit';
import type { Scope } from './scope';

/** The queries the request itself makes before the walk: its session, scope and grants, with room to spare. */
export const REQUEST_QUERIES = 20;

export type AuditVerdict =
  | { state: 'intact'; events: number; head: string }
  | { state: 'broken'; seq: number }
  | { state: 'unfinished'; from: number };

/** Recomputes every event's hash. `broken` names the first seq that does not follow; `unfinished` the first one unread. */
export async function verifyAudit(
  scope: Scope,
  db: D1Database,
  budget: number = D1_QUERIES_PER_INVOCATION,
): Promise<AuditVerdict> {
  if (scope.kind !== 'all') fail('forbidden');
  const chain = await checkChain(db, budget - REQUEST_QUERIES);
  if ('unreadFrom' in chain) return { state: 'unfinished', from: chain.unreadFrom };
  if (!chain.ok) return { state: 'broken', seq: chain.brokenSeq };
  return { state: 'intact', events: chain.head.seq, head: chain.head.hash };
}
