import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { submitWeek } from '../../db/submissions';
import { currentEnv } from '../../lib/env';
import { act, scopeOf } from '../context';
import { csrfField, weekStartField } from '../inputs';
import { ownWeek } from '../own-week';

export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField, weekStart: weekStartField }),
  handler: (input, context) =>
    act(async () => {
      await submitWeek(scopeOf(context), currentEnv().DB, input.weekStart, Date.now());
      return ownWeek(context, input.weekStart);
    }),
});
