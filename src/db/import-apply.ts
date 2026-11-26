// Previewing and applying an import. The preview reads the file against the database and reports; the apply does
// the same, creates the clients and projects the file names that do not exist, and writes every entry, week row,
// assignment and approval in one batch with one `import.apply` event that lists the weeks it approved. `import_batch.id` is the file's SHA-256 and
// every entry carries it, so a second apply under the same mapping finds its cells already written and adds
// nothing, and an apply under another mapping is refused (SEC-25).
import { fail } from '../lib/errors';
import type { ImportPlan } from '../lib/import-types';
import type { NoteKeks } from '../lib/note-crypto';
import { DEFAULT_POLICY, type Policy } from '../lib/policy';
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
import { markAssignments, MAX_SHOWN, planFile, reportOf, type ImportReport } from './import-run';
import { createProject } from './projects';
import { setProjectTasks } from './project-tasks';
import type { Scope } from './scope';

export type { ImportReport };

/** The two import caps a deploy sets: `IMPORT_MAX_ROWS` and `IMPORT_MAX_NEW`. */
export type ImportLimits = Pick<Policy, 'importMaxRows' | 'importMaxNew'>;

/** What applying this file would do, without writing anything. */
export async function previewImport(
  scope: Scope,
  db: D1Database,
  bytes: Uint8Array<ArrayBuffer>,
  limits: ImportLimits = DEFAULT_POLICY,
): Promise<ImportReport> {
  if (scope.kind !== 'all') fail('forbidden');
  const run = await planFile(db, bytes, limits.importMaxRows);
  const known = await markAssignments(db, run.plan.assignments);
  return reportOf(run, false, known.filter((a) => a.n === 1).length);
}

/**
 * Creates the clients and projects the file names that do not exist yet, each with its own audited event and the
 * tasks its rows name as the project's allowed list. The plan carried each under a planned id; the result maps
 * those to the real ones.
 */
async function createReferences(
  scope: Scope,
  db: D1Database,
  kek: string,
  plan: ImportPlan,
  now: number,
  maxNew: number,
): Promise<Map<string, string>> {
  if (plan.newClients.length + plan.newProjects.length > maxNew) {
    fail(
      'invalid_input',
      `the file names more than ${String(maxNew)} new clients and projects; create them first`,
    );
  }
  const real = new Map<string, string>();
  for (const c of plan.newClients) {
    real.set(c.id, (await createClient(scope, db, kek, c.name, now)).id);
  }
  for (const p of plan.newProjects) {
    const clientId = real.get(p.clientId) ?? p.clientId;
    const made = await createProject(
      scope,
      db,
      clientId,
      { name: p.name, number: p.number ?? '' },
      now,
    );
    await setProjectTasks(scope, db, made.id, p.taskIds, now);
    real.set(p.id, made.id);
  }
  return real;
}

/** The plan with every planned id of a new client or project replaced by the real one. */
function withRealIds(plan: ImportPlan, real: ReadonlyMap<string, string>): ImportPlan {
  const id = (planned: string): string => real.get(planned) ?? planned;
  return {
    ...plan,
    entries: plan.entries.map((e) => ({ ...e, clientId: id(e.clientId) })),
    rows: plan.rows.map((r) => ({ ...r, clientId: id(r.clientId), projectId: id(r.projectId) })),
    assignments: plan.assignments.map((a) => ({ ...a, projectId: id(a.projectId) })),
  };
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
  limits: ImportLimits = DEFAULT_POLICY,
): Promise<ImportReport> {
  if (scope.kind !== 'all') fail('forbidden');
  const actor = scope.actorId ?? fail('forbidden');
  return retryOnce(async () => {
    const run = await planFile(db, bytes, limits.importMaxRows);
    if (run.mappingChanged !== null) {
      const { appliedOn, entries } = run.mappingChanged;
      fail(
        'invalid_input',
        `this file was applied under a different import mapping on ${appliedOn}, writing ${String(entries)} entries; correct those weeks through the lock, or save that mapping again`,
      );
    }
    const plan = withRealIds(
      run.plan,
      await createReferences(scope, db, keks.current, run.plan, now, limits.importMaxNew),
    );
    const assignments = await markAssignments(db, plan.assignments);
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
          hundredths: report.hundredths,
          first_date: report.span?.from ?? null,
          last_date: report.span?.to ?? null,
          weeks_approved: report.weeksApproved,
          approved_weeks: plan.approveWeeks
            .slice(0, MAX_SHOWN)
            .map((w) => ({ person_id: w.personId, week_start: w.weekStart })),
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
      plan.ownApprovedWeeks.map((w) => ({ p: w.personId, w: w.weekStart })),
    )) {
      batch.also(db.prepare(WEEKS_IMPORT_ONLY).bind(part, run.hash));
    }
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
