// What an agent's cell save records: one `entries.save` event for the batch, per cell the row, day, hours before
// and after and whether the note changed, never the note's text. A person's own save writes none (entry-writes.ts).
import { auditedBatch } from './audit';
import type { Scope } from './scope';
import { weekTarget } from './submissions';

/** One cell's change, planned: the statement that makes it and what the event says of it. */
export interface Planned {
  rowId: string;
  clientId: string;
  dow: number;
  statement: D1PreparedStatement;
  /** Hours added to the day. The batch applies the most negative first, so no step passes the cap. */
  delta: number;
  /** An insert or update changes one row; zero means the lock predicate refused it. */
  writes: boolean;
  from: number;
  to: number;
  noteChanged: boolean;
}

/**
 * Sends an agent's cells as one batch ending in its event. The event lands only if the last statement changed its
 * row; an earlier statement a concurrent write refused is reported by the caller from the results, as for a person.
 */
export async function auditedCells(
  scope: Scope,
  db: D1Database,
  personId: string,
  weekStart: string,
  planned: readonly Planned[],
  now: number,
): Promise<D1Result[]> {
  const batch = await auditedBatch(scope, db);
  // Only the last statement guards the event; a cell refused by a concurrent unassignment may still be listed.
  const last = planned[planned.length - 1];
  for (const p of planned.slice(0, -1)) batch.also(p.statement);
  const clients = new Set(planned.map((p) => p.clientId));
  if (last !== undefined) {
    await batch.record(
      last.statement,
      {
        at: now,
        action: 'entries.save',
        clientId: clients.size === 1 ? last.clientId : null,
        target: weekTarget(personId, weekStart),
        after: {
          cells: planned
            .toSorted((a, b) => a.rowId.localeCompare(b.rowId) || a.dow - b.dow)
            .map((p) => ({
              row: p.rowId,
              day: p.dow,
              from: p.from,
              to: p.to,
              note_changed: p.noteChanged,
            })),
        },
      },
      1,
    );
  }
  return batch.run();
}
