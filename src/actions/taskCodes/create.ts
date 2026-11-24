import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { createTaskCode } from '../../db/task-codes';
import { currentEnv } from '../../lib/env';
import { act, scopeOf } from '../context';
import { csrfField, nameField } from '../inputs';

export default defineAction({
  accept: 'form',
  input: z.object({
    ...csrfField,
    code: z
      .string()
      .trim()
      .regex(
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,15}$/,
        'Use up to 16 letters, digits, dots, dashes or underscores',
      ),
    name: nameField,
  }),
  handler: (input, context) =>
    act(async () => {
      const { DB } = currentEnv();
      const created = await createTaskCode(scopeOf(context), DB, input, Date.now());
      return { id: created.id, code: created.code };
    }),
});
