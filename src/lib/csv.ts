// CSV as RFC 4180 text, and the formula-injection escape every written cell passes through (SEC-14). Pure.
import { fail } from './errors';

const BOM = '﻿';
const FORMULA_LEAD = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/** A cell a spreadsheet would read as a formula gets a leading apostrophe, which makes it text. */
export function escapeFormula(value: string): string {
  return FORMULA_LEAD.test(value) ? `'${value}` : value;
}

/** One cell as written: formula-escaped, then quoted when it holds a quote, comma or line break. */
export function encodeCell(value: string): string {
  const safe = escapeFormula(value);
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** Rows as CSV text: CRLF line ends, every cell escaped, an optional byte order mark for spreadsheet software. */
export function encodeCsv(rows: readonly (readonly string[])[], bom = false): string {
  const lines = rows.map((row) => row.map(encodeCell).join(','));
  return `${bom ? BOM : ''}${lines.map((line) => `${line}\r\n`).join('')}`;
}

/**
 * CSV text as rows of cells. Accepts CRLF, LF or CR line ends, quoted cells with doubled quotes and line breaks
 * inside, and a leading byte order mark; blank lines are dropped. An unterminated quote is `invalid_input`.
 */
export function parseCsv(text: string): string[][] {
  const source = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let touched = false;
  const endCell = (): void => {
    row.push(cell);
    cell = '';
  };
  const endRow = (): void => {
    if (touched) {
      endCell();
      rows.push(row);
    }
    row = [];
    cell = '';
    touched = false;
  };
  for (let i = 0; i < source.length; i += 1) {
    const ch = source.charAt(i);
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (source.charAt(i + 1) === '"') {
        cell += '"';
        i += 1;
      } else quoted = false;
    } else if (ch === '"' && cell === '') {
      quoted = true;
      touched = true;
    } else if (ch === ',') {
      endCell();
      touched = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source.charAt(i + 1) === '\n') i += 1;
      endRow();
    } else {
      cell += ch;
      touched = true;
    }
  }
  if (quoted) fail('invalid_input', 'the file has a quoted cell that never closes');
  endRow();
  return rows;
}
