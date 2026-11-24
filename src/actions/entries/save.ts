import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { saveCells } from '../../db/entry-writes';
import { currentEnv, noteKeks } from '../../lib/env';
import { act, scopeOf } from '../context';
import { csrfField, weekCells, weekStartField } from '../inputs';
import { ownWeek } from '../own-week';

/** The week and its cell fields: any other field is a string too, and `weekCells` reads the `cell.*` ones. */
const input = z
  .object({ ...csrfField, weekStart: weekStartField })
  .catchall(z.string())
  .transform(({ weekStart, ...fields }, ctx) => {
    const { edits, problems } = weekCells(fields);
    for (const message of problems)
      ctx.issues.push({ code: 'custom', message, input: fields, path: ['cells'] });
    return { weekStart, edits };
  });

export default defineAction({
  accept: 'form',
  input,
  handler: (input, context) =>
    act(async () => {
      const db = currentEnv().DB;
      await saveCells(scopeOf(context), db, noteKeks(), input.weekStart, input.edits, Date.now());
      return ownWeek(context, input.weekStart);
    }),
});
