import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { renameTaskCode } from '../../db/task-codes';
import { currentEnv } from '../../lib/env';
import { act, scopeOf } from '../context';
import { csrfField, idField, nameField } from '../inputs';

export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField, id: idField, name: nameField }),
  handler: (input, context) =>
    act(async () => {
      await renameTaskCode(scopeOf(context), currentEnv().DB, input.id, input.name, Date.now());
      return { id: input.id };
    }),
});
