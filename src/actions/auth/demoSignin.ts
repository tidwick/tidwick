import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { demoSignIn } from '../../auth/demo';
import { throttle } from '../../auth/rate-limit';
import { DEMO_SESSION_MS, endSession, sessionCookie } from '../../auth/session';
import { PERSONA_KEYS } from '../../lib/demo-personas';
import { currentEnv } from '../../lib/env';
import { fail } from '../../lib/errors';
import { act, queueCookie, throttled } from '../context';
import { csrfField } from '../inputs';

export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField, password: z.string().max(200), persona: z.enum(PERSONA_KEYS) }),
  handler: (input, context) =>
    act(async () => {
      const deps = await throttled(context, 'login');
      const env = currentEnv();
      const now = Date.now();
      // Every guess, right or wrong, counts against the smaller per-address limit before the password is compared.
      const ip = context.request.headers.get('cf-connecting-ip') ?? 'local';
      await throttle(env.RATE_LIMIT, env.SESSION_SECRET, ip);
      const sessionId = await demoSignIn(env, input.password, input.persona, now);
      if (sessionId === null) fail('login_failed');
      const previous = context.locals.session;
      if (previous) await endSession(deps.db, deps.secret, previous.rawId, now);
      queueCookie(context, sessionCookie(sessionId, DEMO_SESSION_MS));
      return { next: '/week' };
    }),
});
