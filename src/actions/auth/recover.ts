import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { recover } from '../../auth/recovery';
import { endSession, ENROL_MS, sessionCookie } from '../../auth/session';
import { act, queueCookie, throttled } from '../context';
import { csrfField } from '../inputs';

export default defineAction({
  accept: 'form',
  input: z.object({
    ...csrfField,
    email: z.string().trim().min(3).max(254),
    code: z.string().trim().min(1).max(64),
  }),
  handler: (input, context) =>
    act(async () => {
      const deps = await throttled(context);
      const now = Date.now();
      const { sessionId } = await recover(deps, input.email, input.code, now);
      const previous = context.locals.session;
      if (previous) await endSession(deps.db, deps.secret, previous.rawId, now);
      queueCookie(context, sessionCookie(sessionId, ENROL_MS));
      return { next: '/account' };
    }),
});
