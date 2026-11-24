import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { addRow } from '../../db/week-rows';
import { currentEnv } from '../../lib/env';
import { act, scopeOf } from '../context';
import { csrfField, idField, weekStartField } from '../inputs';
import { ownWeek } from '../own-week';

export default defineAction({
  accept: 'form',
  input: z.object({
    ...csrfField,
    weekStart: weekStartField,
    projectId: idField,
    taskCodeId: idField,
  }),
  handler: (input, context) =>
    act(async () => {
      await addRow(
        scopeOf(context),
        currentEnv().DB,
        input.weekStart,
        input.projectId,
        input.taskCodeId,
      );
      return ownWeek(context, input.weekStart);
    }),
});
