// Previewing and applying an import. The preview reads the file against the database and reports; the apply does
// the same, creates the clients and projects the file names that do not exist, and writes every entry, week row,
// assignment and approval in one batch with one `import.apply` event. `import_batch.id` is the file's SHA-256 and
// every entry carries it, so a second apply under the same mapping finds its cells already written and adds
// nothing, and an apply under another mapping is refused (SEC-25).
import { fail } from '../lib/errors';
import type { NoteKeks } from '../lib/note-crypto';
import { auditedBatch, retryOnce } from './audit';
import { keyRing } from './client-keys';
import { createClient } from './clients';
import { seal } from './entry-writes';
import {
  ASSIGNMENTS_UNCHANGED,
  chunkJson,
  hex,
  INSERT_ASSIGNMENTS,
  INSERT_ENTRIES,
  INSERT_ROWS,
  INSERT_WEEKS,
  UPSERT_BATCH,
  WEEKS_IMPORT_ONLY,
  WEEKS_UNCHANGED,
} from './import-sql';
import {
  markAssignments,
  MAX_SHOWN,
  planFile,
  reportOf,
  type ImportReport,
  type Run,
} from './import-run';
import { createProject } from './projects';
import type { Scope } from './scope';

export type { ImportReport };
export const MAX_NEW_REFERENCES = 50;

/** What applying this file would do, without writing anything. */
export async function previewImport(
  scope: Scope,
  db: D1Database,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<ImportReport> {
  if (scope.kind !== 'all') fail('forbidden');
  const run = await planFile(db, bytes);
  const known = await markAssignments(db, run.plan.assignments);
  const pending = new Set(
    run.plan.pendingAssignments.map(
      (a) => `${a.personId}|${a.client.toLowerCase()}|${a.project.toLowerCase()}`,
    ),
  );
  return reportOf(run, false, known.filter((a) => a.n === 1).length + pending.size);
}

/** Creates the clients and projects the file names that do not exist yet, each with its own audited event. */
async function createReferences(
  scope: Scope,
  db: D1Database,
  kek: string,
  run: Run,
  now: number,
): Promise<void> {
  const { plan } = run;
  if (plan.newClients.length + plan.newProjects.length > MAX_NEW_REFERENCES) {
    fail(
      'invalid_input',
      `the file names more than ${String(MAX_NEW_REFERENCES)} new clients and projects; create them first`,
    );
  }
  for (const name of plan.newClients) {
    run.clientIds.set(name.toLowerCase(), (await createClient(scope, db, kek, name, now)).id);
  }
  for (const p of plan.newProjects) {
    const clientId = run.clientIds.get(p.client.toLowerCase()) ?? fail('not_found');
    const made = await createProject(
      scope,
      db,
      clientId,
      { name: p.name, number: p.number ?? '' },
      now,
    );
    run.projectIds.set(`${clientId}|${p.name.toLowerCase()}`, { id: made.id, clientId });
  }
}

/**
 * Applies the file; applying it again under the same mapping writes nothing new and reports the cells it finds
 * already written, and under another mapping it is refused with the date and count of the first apply.
 */
export async function applyImport(
  scope: Scope,
  db: D1Database,
  keks: NoteKeks,
  bytes: Uint8Array<ArrayBuffer>,
  now: number,
): Promise<ImportReport> {
  if (scope.kind !== 'all') fail('forbidden');
  const actor = scope.actorId ?? fail('forbidden');
  return retryOnce(async () => {
    const run = await planFile(db, bytes);
    if (run.mappingChanged !== null) {
      const { appliedOn, entries } = run.mappingChanged;
      fail(
        'invalid_input',
        `this file was applied under a different import mapping on ${appliedOn}, writing ${String(entries)} entries; correct those weeks through the lock, or save that mapping again`,
      );
    }
    await createReferences(scope, db, keks.current, run, now);
    const { plan } = run;
    const assignments = await markAssignments(db, [
      ...plan.assignments,
      ...plan.pendingAssignments.flatMap((a) => {
        const clientId = run.clientIds.get(a.client.toLowerCase());
        const project =
          clientId === undefined
            ? undefined
            : run.projectIds.get(`${clientId}|${a.project.toLowerCase()}`);
        return project === undefined ? [] : [{ personId: a.personId, projectId: project.id }];
      }),
    ]);
    const added = assignments.filter((a) => a.n === 1);
    const report = reportOf(run, true, added.length);
    const ring = keyRing(db, keks);
    const items: object[] = [];
    for (const e of plan.entries) {
      const [ct, iv, version] = await seal(ring, e.clientId, e.id, e.note);
      items.push({
        id: e.id,
        c: e.clientId,
        r: e.rowId,
        d: e.dow,
        h: e.hundredths,
        ct: ct && hex(ct),
        iv: iv && hex(iv),
        kv: version,
      });
    }
    const batch = await auditedBatch(scope, db);
    const rejectedJson = JSON.stringify(report.rejected);
    await batch.record(
      db
        .prepare(UPSERT_BATCH)
        .bind(
          run.hash,
          actor,
          report.rowsRead,
          plan.entries.length,
          rejectedJson,
          now,
          run.mappingHash,
        ),
      {
        at: now,
        action: 'import.apply',
        clientId: null,
        target: `import:${run.hash}`,
        after: {
          rows_read: report.rowsRead,
          entries: report.entries,
          already_applied: report.alreadyApplied,
          rejected: report.rejectedCount,
          weeks_approved: report.weeksApproved,
          weeks_left_draft: report.weeksLeftDraft,
          assignments_added: added.length,
          assigned: added.slice(0, MAX_SHOWN).map((a) => ({ person_id: a.p, project_id: a.j })),
        },
      },
      1,
    );
    for (const part of chunkJson(
      plan.weeks.map((w) => ({ p: w.personId, w: w.weekStart, s: w.state })),
    )) {
      batch.also(db.prepare(WEEKS_UNCHANGED).bind(part));
    }
    for (const part of chunkJson(assignments)) {
      batch.also(db.prepare(ASSIGNMENTS_UNCHANGED).bind(part));
      batch.also(db.prepare(INSERT_ASSIGNMENTS).bind(part, now));
    }
    for (const part of chunkJson(
      plan.rows.map((r) => ({
        id: r.id,
        c: r.clientId,
        p: r.personId,
        w: r.weekStart,
        j: r.projectId,
        t: r.taskId,
        n: r.position,
      })),
    )) {
      batch.also(db.prepare(INSERT_ROWS).bind(part));
    }
    for (const part of chunkJson(items))
      batch.also(db.prepare(INSERT_ENTRIES).bind(part, run.hash, now));
    for (const part of chunkJson(
      plan.approveWeeks.map((w) => ({ p: w.personId, w: w.weekStart })),
    )) {
      batch.also(db.prepare(WEEKS_IMPORT_ONLY).bind(part, run.hash));
      batch.also(db.prepare(INSERT_WEEKS).bind(part, now, actor));
    }
    await batch.run();
    return report;
  });
}
