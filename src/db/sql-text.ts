// SQL literals for the files a script hands to `wrangler d1 execute --file`, one statement per line.
// Only `restore.ts`, `bootstrap.ts` and `rescue.ts` use them; a request path binds its values instead.
import type { Cell } from '../lib/backup-format.ts';

/** A literal that stays on one line: text with a line break or control character goes as hex. Every
 * numeric column is INTEGER, so any other number is refused as null. */
export function literal(cell: Cell): string | null {
  if (cell === null) return 'NULL';
  if (typeof cell === 'number') return Number.isSafeInteger(cell) ? String(cell) : null;
  if (typeof cell === 'object') return `X'${cell.x}'`;
  if (/[\u0000-\u001f\u007f]/.test(cell)) {
    const bytes = new TextEncoder().encode(cell);
    return `CAST(X'${hex(bytes)}' AS TEXT)`;
  }
  return `'${cell.replaceAll("'", "''")}'`;
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
