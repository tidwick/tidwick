// A button beside the grid (Submit, Copy last week, Remove) posts the whole grid when script is off, so the
// cells the person typed arrive with it. They are saved first, and a save the server refuses stops the action,
// so nothing typed is dropped and nothing is acted on past a refusal.
import type { ActionAPIContext } from 'astro:actions';
import { saveCells } from '../db/entry-writes';
import { currentEnv, noteKeks } from '../lib/env';
import { fail } from '../lib/errors';
import { weekCells } from './inputs';
import { scopeOf } from './context';

/** Saves the `cell.*` fields among `fields`; returns whether there were any to save. */
export async function saveTypedCells(
  context: ActionAPIContext,
  weekStart: string,
  fields: Readonly<Record<string, unknown>>,
): Promise<boolean> {
  const cells: Record<string, string> = {};
  for (const [name, value] of Object.entries(fields)) {
    if (name.startsWith('cell.') && typeof value === 'string') cells[name] = value;
  }
  if (Object.keys(cells).length === 0) return false;
  const { edits, problems } = weekCells(cells);
  if (problems.length > 0) fail('invalid_input', problems.join('; '));
  await saveCells(scopeOf(context), currentEnv().DB, noteKeks(), weekStart, edits, Date.now());
  return true;
}
