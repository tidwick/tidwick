import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { regenerateCodes } from '../../auth/recovery-codes';
import { guardPersona } from '../../auth/demo';
import { authEnv, currentEnv } from '../../lib/env';
import { act, scopeOf, signedIn } from '../context';
import { csrfField } from '../inputs';

export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField }),
  handler: (_input, context) =>
    act(async () => {
      const session = signedIn(context);
      await guardPersona(currentEnv(), session.personId);
      const { db, secret } = authEnv();
      const codes = await regenerateCodes(
        scopeOf(context),
        db,
        secret,
        session.personId,
        Date.now(),
      );
      return { codes };
    }),
});
