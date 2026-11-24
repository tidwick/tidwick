import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { revokeOwnPasskey } from '../../auth/revoke-passkey';
import { currentEnv } from '../../lib/env';
import { act, scopeOf, signedIn } from '../context';
import { credentialIdField, csrfField } from '../inputs';

export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField, id: credentialIdField }),
  handler: (input, context) =>
    act(async () => {
      const session = signedIn(context);
      await revokeOwnPasskey(
        scopeOf(context),
        currentEnv().DB,
        session.personId,
        input.id,
        Date.now(),
      );
      return { id: input.id };
    }),
});
