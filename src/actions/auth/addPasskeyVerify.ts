import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { completeAddPasskey } from '../../auth/add-passkey';
import { clearedChallengeCookie } from '../../auth/challenge';
import { sessionCookie } from '../../auth/session';
import { guardPersona } from '../../auth/demo';
import { authEnv, currentEnv } from '../../lib/env';
import { act, challengeId, queueCookie, signedIn } from '../context';
import { csrfField, registrationJson } from '../inputs';

export default defineAction({
  input: z.object({ ...csrfField, response: registrationJson }),
  handler: (input, context) =>
    act(async () => {
      const session = signedIn(context);
      await guardPersona(currentEnv(), session.personId);
      const id = challengeId(context);
      const deps = authEnv();
      const added = await completeAddPasskey(deps, session, id, input.response, Date.now());
      queueCookie(context, clearedChallengeCookie());
      if (added.sessionId !== null)
        queueCookie(context, sessionCookie(added.sessionId, deps.policy.sessionMaxMs));
      return { next: '/account' };
    }),
});
