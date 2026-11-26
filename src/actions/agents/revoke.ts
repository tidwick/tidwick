import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { revokeOwnGrant } from '../../auth/agent-personal';
import { currentEnv } from '../../lib/env';
import { fail } from '../../lib/errors';
import { act, scopeOf, signedIn } from '../context';
import { csrfField, idField } from '../inputs';

export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField, id: idField }),
  handler: (input, context) =>
    act(async () => {
      if (!currentEnv().MCP) fail('not_found');
      const session = signedIn(context);
      await revokeOwnGrant(
        scopeOf(context),
        currentEnv().DB,
        session.personId,
        input.id,
        Date.now(),
      );
      return { id: input.id };
    }),
});
