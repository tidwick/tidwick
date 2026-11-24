// The audit hash chain, with no imports so scripts/restore.ts checks a backup with the same code.

export const GENESIS = '0'.repeat(64);

export interface ChainEvent {
  seq: number;
  at: number;
  actor_id: string | null;
  action: string;
  client_id: string | null;
  target: string;
  before_json: string | null;
  after_json: string | null;
}

/** The canonical text an event's hash covers: the before and after values are the stored JSON text. */
export function canonical(event: ChainEvent): string {
  return JSON.stringify([
    event.seq,
    event.at,
    event.actor_id,
    event.action,
    event.client_id,
    event.target,
    event.before_json,
    event.after_json,
  ]);
}

/** Hex SHA-256 of the previous hash, a newline and the event's canonical text. */
export async function eventHash(prevHash: string, event: ChainEvent): Promise<string> {
  const bytes = new TextEncoder().encode(`${prevHash}\n${canonical(event)}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface ChainLink extends ChainEvent {
  prev_hash: string;
  hash: string;
}

export interface Head {
  seq: number;
  hash: string;
}

export type LinkVerdict = { ok: true; head: Head } | { ok: false; brokenSeq: number };

/**
 * Checks one page of events in seq order against the head before it. The first event whose seq does
 * not follow, whose prev_hash is not the head's hash, or whose hash does not recompute is reported.
 */
export async function verifyLinks(head: Head, links: readonly ChainLink[]): Promise<LinkVerdict> {
  let current = head;
  for (const link of links) {
    const expected = await eventHash(current.hash, link);
    if (link.seq !== current.seq + 1 || link.prev_hash !== current.hash || link.hash !== expected) {
      return { ok: false, brokenSeq: current.seq + 1 };
    }
    current = { seq: link.seq, hash: link.hash };
  }
  return { ok: true, head: current };
}
