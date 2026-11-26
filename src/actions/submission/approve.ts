import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { decideWeek } from '../../db/submissions';
import { currentEnv } from '../../lib/env';
import { act, scopeOf } from '../context';
import { csrfField, fingerprintField, idField, weekStartField } from '../inputs';
import { personWeek } from '../own-week';

export default defineAction({
  accept: 'form',
  input: z.object({
    ...csrfField,
    personId: idField,
    weekStart: weekStartField,
    fingerprint: fingerprintField,
  }),
  handler: (input, context) =>
    act(async () => {
      const { personId, weekStart } = input;
      await decideWeek(
        scopeOf(context),
        currentEnv().DB,
        personId,
        weekStart,
        'approve',
        Date.now(),
        { unchanged: input.fingerprint },
      );
      return personWeek(context, personId, weekStart);
    }),
});
