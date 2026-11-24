import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { challengeCookie } from '../../auth/challenge';
import { stepUpOptions } from '../../auth/step-up';
import { authEnv } from '../../lib/env';
import { act, queueCookie, signedIn } from '../context';
import { csrfField } from '../inputs';

export default defineAction({
  input: z.object({ ...csrfField }),
  handler: (_input, context) =>
    act(async () => {
      const session = signedIn(context);
      const { options, challengeId } = await stepUpOptions(authEnv(), session, Date.now());
      queueCookie(context, challengeCookie(challengeId));
      return options;
    }),
});
