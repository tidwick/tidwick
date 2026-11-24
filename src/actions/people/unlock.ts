import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { unlockRecovery } from '../../auth/lockout';
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
      const { DB, SESSION_SECRET } = currentEnv();
      const was = await unlockRecovery(scopeOf(context), DB, SESSION_SECRET, input.id, Date.now());
      return { id: input.id, wasLocked: was };
    }),
});
