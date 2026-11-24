import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { addPasskeyOptions } from '../../auth/add-passkey';
import { challengeCookie } from '../../auth/challenge';
import { guardPersona } from '../../auth/demo';
import { authEnv, currentEnv } from '../../lib/env';
import { act, queueCookie, signedIn } from '../context';
import { csrfField } from '../inputs';

export default defineAction({
  input: z.object({ ...csrfField }),
  handler: (_input, context) =>
    act(async () => {
      const session = signedIn(context);
      await guardPersona(currentEnv(), session.personId);
      const { options, challengeId } = await addPasskeyOptions(authEnv(), session, Date.now());
      queueCookie(context, challengeCookie(challengeId));
      return options;
    }),
});
