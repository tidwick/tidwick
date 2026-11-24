import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { addAllAssignments } from '../../db/assignments';
import { currentEnv } from '../../lib/env';
import { act, scopeOf } from '../context';
import { csrfField, idField } from '../inputs';

export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField, personId: idField }),
  handler: (input, context) =>
    act(async () => {
      const added = await addAllAssignments(
        scopeOf(context),
        currentEnv().DB,
        input.personId,
        Date.now(),
      );
      return { personId: input.personId, added };
    }),
});
