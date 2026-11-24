// Unsaved edits, kept apart from the server's week. A draft holds the text as typed; nothing here decides
// whether it is allowed, the Action does. These functions are pure so the totals and the dirty set are testable.
import { formatHours, parseHours } from '../../lib/hours';
import { DAYS_IN_WEEK, type Cell, type GridRow } from '../../lib/week';
import { cellField } from '../../lib/week-form';

export interface Draft {
  hours?: string;
  note?: string;
}

/** Drafts by cell, keyed `<rowId>|<day>`. */
export type Drafts = Readonly<Record<string, Draft>>;

export const draftKey = (rowId: string, dow: number): string => `${rowId}|${String(dow)}`;

/** The text a cell's hours input shows: the draft if there is one, else the stored hours, blank for none. */
export function hoursText(cell: Cell, draft: Draft | undefined): string {
  return draft?.hours ?? (cell.hundredths === 0 ? '' : formatHours(cell.hundredths));
}

export function noteText(cell: Cell, draft: Draft | undefined): string {
  return draft?.note ?? cell.note;
}

/** Whether a draft's hours are not a number the server would read; the cell is marked and totals ignore it. */
export function hoursInvalid(draft: Draft | undefined): boolean {
  return draft?.hours !== undefined && parseHours(draft.hours) === null;
}

/** The week as it would stand if every draft saved: drafted hours replace stored ones where they parse. */
export function withDrafts(rows: readonly GridRow[], drafts: Drafts): GridRow[] {
  return rows.map((row) => ({
    ...row,
    cells: row.cells.map((cell, dow) => {
      const draft = drafts[draftKey(row.rowId, dow)];
      const parsed = draft?.hours === undefined ? null : parseHours(draft.hours);
      return {
        hundredths: parsed ?? cell.hundredths,
        note: draft?.note?.trim() ?? cell.note,
      };
    }),
  }));
}

function isDirty(cell: Cell, draft: Draft | undefined): boolean {
  if (!draft) return false;
  const hours = draft.hours === undefined ? cell.hundredths : parseHours(draft.hours);
  return hours !== cell.hundredths || (draft.note ?? cell.note).trim() !== cell.note;
}

/** The form fields to post: both fields of every cell whose draft differs from what the server holds. */
export function dirtyFields(rows: readonly GridRow[], drafts: Drafts): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const row of rows) {
    for (let dow = 0; dow < DAYS_IN_WEEK; dow++) {
      const cell = row.cells[dow];
      const draft = drafts[draftKey(row.rowId, dow)];
      if (!cell || !isDirty(cell, draft)) continue;
      fields[cellField(row.rowId, dow, 'hours')] = hoursText(cell, draft);
      fields[cellField(row.rowId, dow, 'note')] = noteText(cell, draft);
    }
  }
  return fields;
}

/** The drafts left after a save: a cell is settled when its text still equals what was posted for it. */
export function settled(drafts: Drafts, posted: Readonly<Record<string, string>>): Drafts {
  const left: Record<string, Draft> = {};
  for (const [key, draft] of Object.entries(drafts)) {
    const [rowId = '', day = ''] = key.split('|');
    const hours = posted[cellField(rowId, Number(day), 'hours')];
    const note = posted[cellField(rowId, Number(day), 'note')];
    if (hours === undefined || note === undefined) {
      left[key] = draft;
      continue;
    }
    const unchanged =
      (draft.hours === undefined || draft.hours === hours) &&
      (draft.note === undefined || draft.note === note);
    if (!unchanged) left[key] = draft;
  }
  return left;
}
