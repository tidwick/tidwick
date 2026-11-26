import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { throttle } from '../../auth/rate-limit';
import { claimFirstAdmin } from '../../auth/setup-claim';
import { currentEnv } from '../../lib/env';
import { isAppError } from '../../lib/errors';
import { act, throttled } from '../context';
import { csrfField } from '../inputs';

const text = z.string().trim().min(1).max(200);

export default defineAction({
  accept: 'form',
  input: z.object({
    ...csrfField,
    token: z.string().trim().max(512),
    email: z.string().trim().toLowerCase().max(254),
    name: text,
    firm: text,
  }),
  handler: (input, context) =>
    act(async () => {
      const deps = await throttled(context, 'login');
      const env = currentEnv();
      // Every guess counts against the smaller per-address limit too, as the demo sign-in does.
      const ip = context.request.headers.get('cf-connecting-ip') ?? 'local';
      await throttle(env.RATE_LIMIT, env.SESSION_SECRET, ip);
      const { token, ...who } = input;
      try {
        return await claimFirstAdmin(
          { ...deps, kek: env.NOTE_KEK, setupToken: env.SETUP_TOKEN },
          token,
          { email: who.email, name: who.name, firm: who.firm },
          Date.now(),
        );
      } catch (error) {
        if (isAppError(error) && error.code === 'setup_failed')
          console.warn('tidwick: a first-admin claim was refused: the setup token did not match');
        throw error;
      }
    }),
});
