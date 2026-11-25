import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { guardPersona } from '../../auth/demo';
import { unlinkSso } from '../../auth/unlink-sso';
import { currentEnv } from '../../lib/env';
import { act, scopeOf } from '../context';
import { csrfField, idField } from '../inputs';

export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField, id: idField, identity: idField }),
  handler: (input, context) =>
    act(async () => {
      await guardPersona(currentEnv(), input.id);
      await unlinkSso(scopeOf(context), currentEnv().DB, input.id, input.identity, Date.now());
      return { id: input.id };
    }),
});
