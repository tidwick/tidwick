import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { revokeOwnPasskey } from '../../auth/revoke-passkey';
import { authEnv } from '../../lib/env';
import { keyedHash } from '../../auth/tokens';
import { act, scopeOf, signedIn } from '../context';
import { credentialIdField, csrfField } from '../inputs';

export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField, id: credentialIdField }),
  handler: (input, context) =>
    act(async () => {
      const session = signedIn(context);
      const { db, secret } = authEnv();
      await revokeOwnPasskey(
        scopeOf(context),
        db,
        session.personId,
        input.id,
        await keyedHash(secret, 'session', session.rawId),
        Date.now(),
      );
      return { id: input.id };
    }),
});
