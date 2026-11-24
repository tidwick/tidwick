import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { clearedChallengeCookie } from '../../auth/challenge';
import { completeEnrolment } from '../../auth/enrol';
import { endSession, sessionCookie } from '../../auth/session';
import { act, challengeId, queueCookie, throttled } from '../context';
import { csrfField, registrationJson } from '../inputs';

export default defineAction({
  input: z.object({ ...csrfField, token: z.string().min(1).max(128), response: registrationJson }),
  handler: (input, context) =>
    act(async () => {
      const deps = await throttled(context);
      const now = Date.now();
      const id = challengeId(context);
      const done = await completeEnrolment(deps, input.token, id, input.response, now);
      const previous = context.locals.session;
      if (previous) await endSession(deps.db, deps.secret, previous.rawId, now);
      queueCookie(context, clearedChallengeCookie());
      queueCookie(context, sessionCookie(done.sessionId));
      return { codes: done.codes, next: '/week' };
    }),
});
