import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { logoutOthers } from '../../auth/logout-others';
import { authEnv } from '../../lib/env';
import { act, scopeOf, signedIn } from '../context';
import { csrfField } from '../inputs';

export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField }),
  handler: (_input, context) =>
    act(async () => {
      const session = signedIn(context);
      const { db, secret } = authEnv();
      const ended = await logoutOthers(
        scopeOf(context),
        db,
        secret,
        session.personId,
        session.rawId,
        Date.now(),
      );
      return { ended };
    }),
});
