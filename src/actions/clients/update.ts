import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { renameClient } from '../../db/clients';
import { currentEnv } from '../../lib/env';
import { act, scopeOf } from '../context';
import { csrfField, idField, nameField } from '../inputs';

export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField, id: idField, name: nameField }),
  handler: (input, context) =>
    act(async () => {
      await renameClient(scopeOf(context), currentEnv().DB, input.id, input.name, Date.now());
      return { id: input.id, name: input.name };
    }),
});
