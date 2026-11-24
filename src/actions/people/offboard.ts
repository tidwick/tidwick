import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { offboard } from '../../auth/offboard';
import { guardPersona } from '../../auth/demo';
import { currentEnv } from '../../lib/env';
import { act, scopeOf } from '../context';
import { csrfField, idField } from '../inputs';

export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField, id: idField }),
  handler: (input, context) =>
    act(async () => {
      await guardPersona(currentEnv(), input.id);
      await offboard(scopeOf(context), currentEnv().DB, input.id, Date.now());
      return { id: input.id };
    }),
});
