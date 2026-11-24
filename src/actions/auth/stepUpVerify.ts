import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { clearedChallengeCookie } from '../../auth/challenge';
import { completeStepUp } from '../../auth/step-up';
import { authEnv } from '../../lib/env';
import { act, challengeId, queueCookie, signedIn } from '../context';
import { authenticationJson, csrfField } from '../inputs';

export default defineAction({
  input: z.object({ ...csrfField, response: authenticationJson }),
  handler: (input, context) =>
    act(async () => {
      const session = signedIn(context);
      await completeStepUp(authEnv(), session, challengeId(context), input.response, Date.now());
      queueCookie(context, clearedChallengeCookie());
      return { steppedUp: true };
    }),
});
