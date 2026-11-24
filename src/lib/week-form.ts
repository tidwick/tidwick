// The field names a week posts as form data, shared by the no-script form and the island so one zod schema
// serves both: `cell.<rowId>.<day>.hours` and `cell.<rowId>.<day>.note`, day 0 for Monday.
import { DAY_CAP, parseHours } from './hours';
import { DAY_NAMES, NOTE_MAX } from './week';

/** One cell as the person wants it: hours and the note's text, replacing what is stored. */
export interface CellEdit {
  rowId: string;
  dow: number;
  hundredths: number;
  note: string;
}

export type CellPart = 'hours' | 'note';

export const cellField = (rowId: string, dow: number, part: CellPart): string =>
  `cell.${rowId}.${String(dow)}.${part}`;

const CELL_FIELD = /^cell\.([A-Za-z0-9-]{1,64})\.([0-6])\.(hours|note)$/;

export interface ParsedCells {
  edits: CellEdit[];
  /** One message per bad cell, each naming the day. */
  problems: string[];
}

/**
 * The edits in a posted form's fields. A cell needs both its hours and its note field; hours are any decimal
 * (more than two places round half up), a day over 24 hours or a note over 2,000 characters is a problem, and
 * a field that starts with `cell.` but is not a cell field is one too. Other fields are not cells and are skipped.
 */
export function readCells(fields: Readonly<Record<string, string>>): ParsedCells {
  const found = new Map<string, { rowId: string; dow: number; hours?: string; note?: string }>();
  const problems: string[] = [];
  for (const [name, value] of Object.entries(fields)) {
    if (!name.startsWith('cell.')) continue;
    const match = CELL_FIELD.exec(name);
    if (!match) {
      problems.push('A cell field is not recognised; reload the page');
      continue;
    }
    const [, rowId = '', day = '', part = ''] = match;
    const key = `${rowId}|${day}`;
    const cell = found.get(key) ?? { rowId, dow: Number(day) };
    if (part === 'hours') cell.hours = value;
    else cell.note = value;
    found.set(key, cell);
  }
  const edits: CellEdit[] = [];
  for (const cell of found.values()) {
    const day = DAY_NAMES[cell.dow] ?? 'A day';
    const hundredths = parseHours(cell.hours ?? '');
    const note = (cell.note ?? '').trim();
    if (cell.hours === undefined || cell.note === undefined) {
      problems.push(`${day}: the hours and the note must both be sent; reload the page`);
    } else if (hundredths === null) {
      problems.push(`${day}: enter hours as a number, such as 7.5`);
    } else if (hundredths > DAY_CAP) {
      problems.push(`${day}: a day cannot pass 24 hours`);
    } else if (note.length > NOTE_MAX) {
      problems.push(`${day}: a note is at most ${String(NOTE_MAX)} characters`);
    } else {
      edits.push({ rowId: cell.rowId, dow: cell.dow, hundredths, note });
    }
  }
  return { edits, problems };
}
