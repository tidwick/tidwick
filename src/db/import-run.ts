// Reading one import file against the database: its hash, the mapping it is read under and that mapping's hash,
// the batch the same file left before, the plan, and the report the preview and the apply both return. Reads only.
import { MAX_IMPORT_BYTES, readImport, type ReadResult } from '../lib/import';
import { fail } from '../lib/errors';
import { planImport } from '../lib/import-plan';
import type { ImportPlan } from '../lib/import-types';
import { loadImportMapping } from './csv-settings';
import { chunkJson, hex } from './import-sql';
import { heldAssignments, loadExisting, loadReference, priorBatch } from './import-reference';

/** Rejections, and assignments in the event, listed by name; the counts are totals. */
export const MAX_SHOWN = 200;

export interface ImportReport {
  applied: boolean;
  rowsRead: number;
  /** Entries the apply wrote, or the preview would write. */
  entries: number;
  /** Cells this same file already wrote. */
  alreadyApplied: number;
  /** Rows whose hours had more than two decimal places and were rounded half up. */
  roundedRows: number;
  rejectedCount: number;
  /** The first rejections by line; `rejectedCount` is the total. */
  rejected: { line: number; reason: string }[];
  newClients: string[];
  newProjects: { client: string; name: string }[];
  needsAdmin: string[];
  /** The hours of the entries, in hundredths. */
  hundredths: number;
  /** First and last date of the entries, or null with none. */
  span: { from: string; to: string } | null;
  weeksApproved: number;
  /** The weeks the apply approves, by the person's email, as far as `MAX_SHOWN`. */
  approvedWeeks: { email: string; weekStart: string }[];
  /** Touched weeks with no submission that also hold the owner's own entries, so they stay draft. */
  weeksLeftDraft: number;
  /** Person and project pairs the import assigns that were not assigned before. */
  assignmentsAdded: number;
  /** Set when this file was applied before under another import mapping, which the apply refuses. */
  mappingChanged: { appliedOn: string; entries: number } | null;
}

export interface Run {
  hash: string;
  mappingHash: string;
  read: ReadResult;
  plan: ImportPlan;
  mappingChanged: ImportReport['mappingChanged'];
  /** Each person's email by id, for listing weeks. */
  emails: Map<string, string>;
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

/** JSON with every object's keys sorted, so one mapping always hashes the same. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).toSorted(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
}

/** The file as text; bytes that are not UTF-8 are refused, since a lenient decode would store replacement characters as names. */
function decodeUtf8(bytes: Uint8Array<ArrayBuffer>): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('invalid_input', 'the file is not UTF-8 text; save it as CSV (UTF-8) and try again');
  }
}

export async function planFile(db: D1Database, bytes: Uint8Array<ArrayBuffer>): Promise<Run> {
  if (bytes.byteLength > MAX_IMPORT_BYTES)
    fail('invalid_input', 'the file is over 2 MB; split it by date range');
  const hash = await sha256Hex(bytes);
  const mapping = await loadImportMapping(db);
  const mappingHash = await sha256Hex(new TextEncoder().encode(canonicalJson(mapping)));
  const prior = await priorBatch(db, hash);
  const read = readImport(decodeUtf8(bytes), mapping);
  const ref = await loadReference(db);
  const existing = await loadExisting(db, read.rows, ref);
  const plan = planImport(read.rows, ref, existing, hash);
  return {
    hash,
    mappingHash,
    read,
    plan,
    mappingChanged:
      prior === null || prior.mappingHash === mappingHash
        ? null
        : {
            appliedOn: new Date(prior.finishedAt ?? 0).toISOString().slice(0, 10),
            entries: prior.entries,
          },
    emails: new Map(ref.people.map((p) => [p.id, p.email])),
  };
}

/** Pairs without repeats, each marked new (1) or already held (0), as the guard and the event read them. */
export async function markAssignments(
  db: D1Database,
  pairs: readonly { personId: string; projectId: string }[],
): Promise<{ p: string; j: string; n: 0 | 1 }[]> {
  const unique = [...new Map(pairs.map((a) => [`${a.personId}|${a.projectId}`, a])).values()];
  const held = await heldAssignments(
    db,
    chunkJson(unique.map((a) => ({ p: a.personId, j: a.projectId }))),
  );
  return unique.map((a) => ({
    p: a.personId,
    j: a.projectId,
    n: held.has(`${a.personId}|${a.projectId}`) ? 0 : 1,
  }));
}

/** What the run did or would do; `assignmentsAdded` is passed in, since only the apply knows new projects' ids. */
export function reportOf(run: Run, applied: boolean, assignmentsAdded: number): ImportReport {
  const rejected = [...run.read.rejected, ...run.plan.rejected].toSorted((a, b) => a.line - b.line);
  return {
    applied,
    rowsRead: run.read.rowsRead,
    entries: run.plan.entries.length,
    alreadyApplied: run.plan.alreadyApplied,
    roundedRows: run.plan.roundedRows,
    rejectedCount: rejected.length,
    rejected: rejected.slice(0, MAX_SHOWN),
    newClients: run.plan.newClients.map((c) => c.name),
    newProjects: run.plan.newProjects.map((p) => ({ client: p.client, name: p.name })),
    needsAdmin: run.plan.needsAdmin,
    hundredths: run.plan.entries.reduce((sum, e) => sum + e.hundredths, 0),
    span: run.plan.span,
    weeksApproved: run.plan.approveWeeks.length,
    approvedWeeks: run.plan.approveWeeks.slice(0, MAX_SHOWN).map((w) => ({
      email: run.emails.get(w.personId) ?? w.personId,
      weekStart: w.weekStart,
    })),
    weeksLeftDraft: run.plan.draftWeeks.length,
    assignmentsAdded,
    mappingChanged: run.mappingChanged,
  };
}
