// Turns a UNIQUE violation from D1 into the catalog error for the key that was taken. Any other error passes on.
import { fail, type ErrorCode } from '../lib/errors';

/** `taken` maps the constraint's column list, as SQLite names it, to the catalog error; throws on a match. */
export function translateUnique(error: unknown, taken: Readonly<Record<string, ErrorCode>>): void {
  if (!(error instanceof Error)) return;
  for (const [columns, code] of Object.entries(taken)) {
    if (error.message.includes(`UNIQUE constraint failed: ${columns}`)) fail(code);
  }
}
