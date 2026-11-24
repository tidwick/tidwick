import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { clearedSessionCookie, endSession } from '../../auth/session';
import { authEnv } from '../../lib/env';
import { act, queueCookie, signedIn } from '../context';
import { csrfField } from '../inputs';

export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField }),
  handler: (_input, context) =>
    act(async () => {
      const session = signedIn(context);
      const { db, secret } = authEnv();
      await endSession(db, secret, session.rawId, Date.now());
      context.locals.session = null;
      context.locals.csrf = '';
      queueCookie(context, clearedSessionCookie());
      return { next: '/login' };
    }),
});
