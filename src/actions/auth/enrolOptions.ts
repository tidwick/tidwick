import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { challengeCookie } from '../../auth/challenge';
import { enrolOptions } from '../../auth/enrol';
import { act, queueCookie, throttled } from '../context';
import { csrfField } from '../inputs';

export default defineAction({
  input: z.object({ ...csrfField, token: z.string().min(1).max(128) }),
  handler: (input, context) =>
    act(async () => {
      const deps = await throttled(context);
      const { options, challengeId } = await enrolOptions(deps, input.token, Date.now());
      queueCookie(context, challengeCookie(challengeId));
      return options;
    }),
});
