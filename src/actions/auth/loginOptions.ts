import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { challengeCookie } from '../../auth/challenge';
import { loginOptions } from '../../auth/login';
import { act, queueCookie, throttled } from '../context';
import { csrfField } from '../inputs';

export default defineAction({
  input: z.object({ ...csrfField }),
  handler: (_input, context) =>
    act(async () => {
      const { options, challengeId } = await loginOptions(
        await throttled(context, 'login'),
        Date.now(),
      );
      queueCookie(context, challengeCookie(challengeId));
      return options;
    }),
});
