import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { decideWeek } from '../../db/submissions';
import { currentEnv } from '../../lib/env';
import { act, scopeOf } from '../context';
import { csrfField, idField, weekStartField } from '../inputs';
import { personWeek } from '../own-week';

export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField, personId: idField, weekStart: weekStartField }),
  handler: (input, context) =>
    act(async () => {
      const { personId, weekStart } = input;
      await decideWeek(
        scopeOf(context),
        currentEnv().DB,
        personId,
        weekStart,
        'return',
        Date.now(),
      );
      return personWeek(context, personId, weekStart);
    }),
});
