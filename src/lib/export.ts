// The export: entries of one client rendered through the adopter's column mapping, one row per entry. Pure; the
// rows come from `src/db/export-rows.ts` and `encodeCsv()` escapes every cell on the way out.
import type { ExportColumn, ExportField, ExportMapping } from './csv-mapping';
import { formatDate } from './csv-dates';
import { encodeCsv } from './csv';
import { formatHoursFixed } from './hours';

/** One approved entry with its note opened, ready to render. */
export interface ExportEntry {
  /** The entry's civil date. */
  date: string;
  weekStart: string;
  personName: string;
  personEmail: string;
  personCode: string | null;
  clientName: string;
  projectNumber: string | null;
  projectName: string;
  taskCode: string;
  taskName: string;
  hundredths: number;
  note: string;
}

function fieldValue(entry: ExportEntry, field: ExportField, mapping: ExportMapping): string {
  switch (field) {
    case 'date':
      return formatDate(entry.date, mapping.date_format);
    case 'week_start':
      return formatDate(entry.weekStart, mapping.date_format);
    case 'person_name':
      return entry.personName;
    case 'person_email':
      return entry.personEmail;
    case 'person_code':
      return entry.personCode ?? '';
    case 'client_name':
      return entry.clientName;
    case 'project_number':
      return entry.projectNumber ?? '';
    case 'project_name':
      return entry.projectName;
    case 'task_code':
      return entry.taskCode;
    case 'task_name':
      return entry.taskName;
    case 'hours':
      return formatHoursFixed(entry.hundredths);
    case 'note':
      return entry.note;
  }
}

/** Keeps the first `max` characters, never splitting a surrogate pair. */
function clip(text: string, max: number | undefined): string {
  return max === undefined ? text : Array.from(text).slice(0, max).join('');
}

/**
 * Every run of whitespace that holds a line break becomes one space, so a cell stays on one line. Split and trim,
 * never one pattern like `\s*[\r\n]+\s*`, which backtracks quadratically on a long run with no break.
 */
function oneLine(text: string): string {
  const parts = text.split(/[\r\n]+/);
  const last = parts.length - 1;
  if (last === 0) return text;
  return parts
    .map((part, i) => (i === 0 ? part.trimEnd() : i === last ? part.trimStart() : part.trim()))
    .filter((part, i) => i === 0 || i === last || part !== '')
    .join(' ');
}

function cellValue(entry: ExportEntry, column: ExportColumn, mapping: ExportMapping): string {
  let text = '';
  if (column.field !== undefined) text = fieldValue(entry, column.field, mapping);
  else if (column.literal !== undefined) text = column.literal;
  else if (column.template !== undefined) {
    text = column.template.replace(/\{([a-z_]+)\}/g, (_, name: string) =>
      fieldValue(entry, name as ExportField, mapping),
    );
  }
  return clip(oneLine(text), column.max);
}

/** The header row and one row per entry, in the mapping's column order. */
export function exportRows(entries: readonly ExportEntry[], mapping: ExportMapping): string[][] {
  return [
    mapping.columns.map((column) => column.header),
    ...entries.map((entry) => mapping.columns.map((column) => cellValue(entry, column, mapping))),
  ];
}

/** The file's text: the mapped rows as CSV, every cell escaped against formula injection. */
export function exportCsv(entries: readonly ExportEntry[], mapping: ExportMapping): string {
  return encodeCsv(exportRows(entries, mapping), mapping.bom);
}
