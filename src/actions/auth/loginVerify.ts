import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { clearedChallengeCookie } from '../../auth/challenge';
import { completeLogin } from '../../auth/login';
import { endSession, sessionCookie } from '../../auth/session';
import { act, challengeId, queueCookie, throttled } from '../context';
import { authenticationJson, csrfField } from '../inputs';

export default defineAction({
  input: z.object({ ...csrfField, response: authenticationJson }),
  handler: (input, context) =>
    act(async () => {
      const deps = await throttled(context, 'login');
      const now = Date.now();
      const login = await completeLogin(deps, challengeId(context), input.response, now);
      const previous = context.locals.session;
      if (previous) await endSession(deps.db, deps.secret, previous.rawId, now);
      queueCookie(context, clearedChallengeCookie());
      queueCookie(context, sessionCookie(login.sessionId));
      return { next: '/week' };
    }),
});
