import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { saveCellsFor } from '../../db/entries-for';
import { currentEnv, noteKeks } from '../../lib/env';
import { act, scopeOf } from '../context';
import { csrfField, idField, weekCells, weekStartField } from '../inputs';
import { personWeek } from '../own-week';

/** The person, the week and its cell fields, read as `entries.save` reads them. */
const input = z
  .object({ ...csrfField, personId: idField, weekStart: weekStartField })
  .catchall(z.string())
  .transform(({ personId, weekStart, ...fields }, ctx) => {
    const { edits, problems } = weekCells(fields);
    for (const message of problems)
      ctx.issues.push({ code: 'custom', message, input: fields, path: ['cells'] });
    return { personId, weekStart, edits };
  });

export default defineAction({
  accept: 'form',
  input,
  handler: (input, context) =>
    act(async () => {
      const { personId, weekStart, edits } = input;
      const db = currentEnv().DB;
      await saveCellsFor(scopeOf(context), db, noteKeks(), personId, weekStart, edits, Date.now());
      return personWeek(context, personId, weekStart);
    }),
});
