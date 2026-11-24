import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { createClient } from '../../db/clients';
import { currentEnv } from '../../lib/env';
import { act, scopeOf } from '../context';
import { csrfField, nameField } from '../inputs';

export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField, name: nameField }),
  handler: (input, context) =>
    act(async () => {
      const { DB, NOTE_KEK } = currentEnv();
      const client = await createClient(scopeOf(context), DB, NOTE_KEK, input.name, Date.now());
      return { id: client.id, name: client.name };
    }),
});
