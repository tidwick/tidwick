import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { GRANTS } from '../../db/roles';
import { setGrants } from '../../db/role-grants';
import { guardPersona } from '../../auth/demo';
import { currentEnv } from '../../lib/env';
import { act, scopeOf } from '../context';
import { csrfField, idField } from '../inputs';

export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField, id: idField, grants: z.array(z.enum(GRANTS)).default([]) }),
  handler: (input, context) =>
    act(async () => {
      await guardPersona(currentEnv(), input.id);
      await setGrants(scopeOf(context), currentEnv().DB, input.id, input.grants, Date.now());
      return { id: input.id, grants: input.grants };
    }),
});
