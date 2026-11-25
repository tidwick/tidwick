// The week as an agent reads it, and the cells it sends as the form fields the week Actions parse, so the 24-hour,
// 2,000-character and decimal rules keep their one home (`weekCells`, `readCells`).
import { z } from 'astro/zod';
import { idField } from '../actions/inputs';
import { MAX_WEEK_ROWS } from '../lib/limits';
import { cellField } from '../lib/week-form';
import { DAYS_IN_WEEK, isBlank, type WeekView } from '../lib/week';

/** Characters of a note a result carries, when notes are on at all. */
export const NOTE_SHOWN = 500;

export const cellsInput = z
  .array(
    z.object({
      rowId: idField,
      day: z.number().int().min(0).max(6).describe('Monday is 0, Sunday is 6'),
      hours: z
        .union([z.string().max(32), z.number()])
        .describe('Hours for the day as a decimal such as 7.5; 0 clears it'),
      note: z
        .string()
        .optional()
        .describe('Left out, the stored note is kept; an empty string clears it'),
    }),
  )
  .min(1)
  .max(MAX_WEEK_ROWS * DAYS_IN_WEEK);

export type CellInput = z.infer<typeof cellsInput>[number];

/**
 * The `cell.<row>.<day>.hours|note` fields for these cells. A cell with no `note` keeps the one stored: the form
 * parser needs both fields and a cell replaces its note, so without this an agent that never sees notes would blank
 * every one it touched.
 */
export function cellFields(cells: readonly CellInput[], week: WeekView): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const c of cells) {
    const stored = week.rows.find((r) => r.rowId === c.rowId)?.cells[c.day]?.note ?? '';
    fields[cellField(c.rowId, c.day, 'hours')] = String(c.hours);
    fields[cellField(c.rowId, c.day, 'note')] = c.note ?? stored;
  }
  return fields;
}

/** A week as the tools return it: only the cells that hold something, and a note's text only when notes are on. */
export function weekOutput(week: WeekView, notes: 'off' | 'read') {
  return {
    weekStart: week.weekStart,
    state: week.state,
    rows: week.rows.map(({ cells, ...row }) => ({
      ...row,
      cells: cells.flatMap((cell, day) =>
        isBlank(cell)
          ? []
          : [
              {
                day,
                hundredths: cell.hundredths,
                has_note: cell.note !== '',
                ...(notes === 'read' && cell.note !== ''
                  ? { note: cell.note.slice(0, NOTE_SHOWN) }
                  : {}),
              },
            ],
      ),
    })),
  };
}
