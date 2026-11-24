// Resolving read rows against what the database holds, with no database in sight: which person, client, project
// and task each row means, which cells are new, already applied from this file, or blocked, and what an admin
// must add before a rejected row can land. A touched week with no submission is approved only when it holds
// nothing but this file's entries; one holding the owner's own hours stays draft for the owner to submit. The
// same plan feeds the preview and the apply. Pure.
import { DAY_CAP } from './hours';
import type { ImportRow } from './import';
import { key, KEY, resolveRows, type Resolved } from './import-resolve';
import type { ImportExisting, ImportPlan, ImportReference } from './import-types';
import { newId } from './ids';
import { MAX_WEEK_ROWS } from './limits';
import { NOTE_MAX } from './week';

/** Plans an import: every row ends as an entry to write, an already applied cell, or a rejection with its reason. */
export function planImport(
  rows: readonly ImportRow[],
  ref: ImportReference,
  existing: ImportExisting,
  batchId: string,
): ImportPlan {
  const plan: ImportPlan = {
    entries: [],
    rows: [],
    rejected: [],
    alreadyApplied: 0,
    roundedRows: rows.filter((r) => r.rounded).length,
    newClients: [],
    newProjects: [],
    assignments: [],
    pendingAssignments: [],
    needsAdmin: [],
    weeks: [],
    approveWeeks: [],
    draftWeeks: [],
  };
  const reject = (lines: readonly number[], reason: string): void => {
    for (const line of lines) plan.rejected.push({ line, reason });
  };
  const resolved = resolveRows(rows, ref, plan, reject);
  const cells = mergeCells(resolved);
  const rowAt = new Map(
    existing.rows.map((r) => [key(r.personId, r.weekStart, r.projectId, r.taskId), r]),
  );
  const stateOf = new Map(existing.submissions.map((s) => [key(s.personId, s.weekStart), s.state]));
  const held = new Map(
    existing.cells.map((c) => [key(c.personId, c.weekStart, c.projectId, c.taskId, c.dow), c]),
  );
  const dayTotal = new Map<string, number>();
  const othersWrote = new Set<string>();
  for (const c of existing.cells) {
    if (c.importId !== batchId) othersWrote.add(key(c.personId, c.weekStart));
    const day = key(c.personId, c.weekStart, c.dow);
    dayTotal.set(day, (dayTotal.get(day) ?? 0) + c.hundredths);
  }
  const rowCount = new Map<string, number>();
  const nextPosition = new Map<string, number>();
  for (const r of existing.rows) {
    const week = key(r.personId, r.weekStart);
    rowCount.set(week, (rowCount.get(week) ?? 0) + 1);
    nextPosition.set(week, Math.max(nextPosition.get(week) ?? 0, r.position + 1));
  }
  const touched = new Set<string>();
  const assigned = new Map<string, { personId: string; projectId: string }>();
  const lines = (c: Merged): number[] => c.rows.map((r) => r.row.line);
  for (const cell of cells) {
    const { row, personId, clientId, projectId, taskId } = cell.rows[0] as Resolved;
    const week = key(personId, row.weekStart);
    const already = held.get(key(personId, row.weekStart, projectId, taskId, row.dow));
    if (already !== undefined) {
      if (already.importId === batchId) plan.alreadyApplied += 1;
      else reject(lines(cell), 'that cell already holds hours from elsewhere');
      continue;
    }
    const state = stateOf.get(week);
    if (state === 'submitted' || state === 'returned') {
      reject(lines(cell), `the week of ${row.weekStart} is ${state}`);
      continue;
    }
    if (cell.note.length > NOTE_MAX) {
      reject(lines(cell), 'note over 2000 characters once rows for one cell are joined');
      continue;
    }
    const day = key(personId, row.weekStart, row.dow);
    if ((dayTotal.get(day) ?? 0) + cell.hundredths > DAY_CAP) {
      reject(lines(cell), `day over 24 hours on ${row.date}`);
      continue;
    }
    let rowId = rowAt.get(key(personId, row.weekStart, projectId, taskId))?.id;
    if (rowId === undefined) {
      if ((rowCount.get(week) ?? 0) >= MAX_WEEK_ROWS) {
        reject(
          lines(cell),
          `the week of ${row.weekStart} would pass ${String(MAX_WEEK_ROWS)} rows`,
        );
        continue;
      }
      rowId = newId();
      const position = nextPosition.get(week) ?? 0;
      plan.rows.push({
        id: rowId,
        clientId,
        personId,
        weekStart: row.weekStart,
        projectId,
        taskId,
        position,
      });
      rowAt.set(key(personId, row.weekStart, projectId, taskId), {
        id: rowId,
        personId,
        weekStart: row.weekStart,
        projectId,
        taskId,
        position,
      });
      rowCount.set(week, (rowCount.get(week) ?? 0) + 1);
      nextPosition.set(week, position + 1);
    }
    dayTotal.set(day, (dayTotal.get(day) ?? 0) + cell.hundredths);
    plan.entries.push({
      id: newId(),
      rowId,
      clientId,
      personId,
      dow: row.dow,
      hundredths: cell.hundredths,
      note: cell.note,
    });
    touched.add(week);
    assigned.set(key(personId, projectId), { personId, projectId });
  }
  plan.assignments = [...assigned.values()];
  plan.weeks = [...touched].map((week) => {
    const [personId = '', weekStart = ''] = week.split(KEY);
    return { personId, weekStart, state: stateOf.get(week) ?? null };
  });
  for (const week of plan.weeks) {
    if (week.state !== null) continue;
    const target = { personId: week.personId, weekStart: week.weekStart };
    if (othersWrote.has(key(week.personId, week.weekStart))) plan.draftWeeks.push(target);
    else plan.approveWeeks.push(target);
  }
  plan.needsAdmin = [...new Set(plan.needsAdmin)].toSorted();
  plan.rejected.sort((a, b) => a.line - b.line);
  return plan;
}

interface Merged {
  rows: Resolved[];
  hundredths: number;
  note: string;
}

/** Rows for one person, project, task and day sum their hours and join their notes with "; ". */
function mergeCells(resolved: readonly Resolved[]): Merged[] {
  const cells = new Map<string, Merged>();
  for (const r of resolved) {
    const id = key(r.personId, r.projectId, r.taskId, r.row.date);
    const cell = cells.get(id) ?? { rows: [], hundredths: 0, note: '' };
    cell.rows.push(r);
    cell.hundredths += r.row.hundredths;
    cell.note = [cell.note, r.row.note].filter((n) => n !== '').join('; ');
    cells.set(id, cell);
  }
  return [...cells.values()];
}
