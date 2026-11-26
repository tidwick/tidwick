import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { copyLastWeek } from '../../db/week-rows';
import { currentEnv } from '../../lib/env';
import { act, scopeOf } from '../context';
import { csrfField, weekStartField } from '../inputs';
import { ownWeek } from '../own-week';
import { saveTypedCells } from '../typed-cells';

export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField, weekStart: weekStartField }).catchall(z.string()),
  handler: (input, context) =>
    act(async () => {
      await saveTypedCells(context, input.weekStart, input);
      await copyLastWeek(scopeOf(context), currentEnv().DB, input.weekStart);
      return ownWeek(context, input.weekStart);
    }),
});
