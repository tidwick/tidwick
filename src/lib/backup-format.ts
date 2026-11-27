// The backup file's lines: one header, then one JSON line per row. No imports, so scripts/restore.ts reads a
// backup with the same code that wrote it.

export const FORMAT = 'tidwick-backup';
export const VERSION = 1;

export interface BackupHeader {
  format: string;
  version: number;
  schema_version: string | null;
  created_at: number;
  chain_seq: number;
  chain_head: string;
  /** SHA-256 of every line that is not an audit event, in file order; see `rowsDigest`. */
  rows_digest: string;
}

/** A stored value: text, integer, null, or a BLOB as hex under `x`. */
export type Cell = string | number | null | { x: string };

export interface BackupLine {
  t: string;
  r: Record<string, Cell>;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** D1 hands a BLOB back as an ArrayBuffer, a typed array or an array of byte values, depending on the path. */
export function encodeCell(value: unknown): Cell {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  if (value instanceof ArrayBuffer) return { x: hex(new Uint8Array(value)) };
  if (ArrayBuffer.isView(value)) {
    return { x: hex(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
  }
  if (Array.isArray(value)) return { x: hex(Uint8Array.from(value as number[])) };
  return null;
}

export function encodeLine(table: string, row: Record<string, unknown>): string {
  const r: Record<string, Cell> = {};
  for (const [column, value] of Object.entries(row)) r[column] = encodeCell(value);
  return JSON.stringify({ t: table, r } satisfies BackupLine);
}

/**
 * SHA-256 (hex) over the raw text of every line that is not an audit event, each followed by a newline, in file
 * order. The audit chain covers the audit events only; this covers every other row. Neither is keyed, so a
 * value inside the file proves nothing: it protects only because the operator records it outside the file.
 */
export async function rowsDigest(rows: readonly string[]): Promise<string> {
  const bytes = new TextEncoder().encode(rows.map((row) => `${row}\n`).join(''));
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHeader(value: unknown): value is BackupHeader {
  if (!isRecord(value)) return false;
  return (
    value.format === FORMAT &&
    value.version === VERSION &&
    (value.schema_version === null || typeof value.schema_version === 'string') &&
    typeof value.created_at === 'number' &&
    typeof value.chain_seq === 'number' &&
    typeof value.chain_head === 'string' &&
    typeof value.rows_digest === 'string'
  );
}

function isCell(value: unknown): value is Cell {
  if (value === null || typeof value === 'string' || typeof value === 'number') return true;
  return isRecord(value) && typeof value.x === 'string' && /^(?:[0-9a-f]{2})*$/.test(value.x);
}

function isLine(value: unknown): value is BackupLine {
  return (
    isRecord(value) &&
    typeof value.t === 'string' &&
    isRecord(value.r) &&
    Object.values(value.r).every(isCell)
  );
}

export type Parsed =
  | { ok: true; header: BackupHeader; lines: BackupLine[]; rows: string[] }
  | { ok: false; why: string };

/** Reads a decrypted, decompressed backup; names the first line that is not what the writer emits. */
export function parseBackup(text: string): Parsed {
  const raw = text.split('\n').filter((line) => line !== '');
  const [first, ...rest] = raw;
  let header: unknown;
  try {
    header = JSON.parse(first ?? 'null');
  } catch {
    return { ok: false, why: 'line 1 is not JSON' };
  }
  if (!isHeader(header))
    return { ok: false, why: `line 1 is not a ${FORMAT} v${String(VERSION)} header` };
  const lines: BackupLine[] = [];
  const rows: string[] = [];
  for (const [i, line] of rest.entries()) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return { ok: false, why: `line ${String(i + 2)} is not JSON` };
    }
    if (!isLine(value)) return { ok: false, why: `line ${String(i + 2)} is not a table row` };
    lines.push(value);
    if (value.t !== 'audit_event') rows.push(line);
  }
  return { ok: true, header, lines, rows };
}
