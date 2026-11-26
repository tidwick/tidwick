import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { guardPersona } from '../../auth/demo';
import { mintPersonalToken, LABEL_MAX, TOKEN_SCOPES } from '../../auth/agent-personal';
import { authEnv, currentEnv } from '../../lib/env';
import { fail } from '../../lib/errors';
import { act, scopeOf, signedIn } from '../context';
import { csrfField } from '../inputs';

// The token goes back to the page that rendered the form and nowhere else: nothing stores it, so a reload shows none.
export default defineAction({
  accept: 'form',
  input: z.object({
    ...csrfField,
    label: z.string().trim().min(1, 'Enter a label').max(LABEL_MAX),
    days: z.coerce.number().int(),
    scopes: z.array(z.enum(TOKEN_SCOPES)).default([]),
  }),
  handler: (input, context) =>
    act(async () => {
      if (!currentEnv().MCP) fail('not_found');
      const session = signedIn(context);
      await guardPersona(currentEnv(), session.personId);
      const { db, secret } = authEnv();
      const minted = await mintPersonalToken(
        scopeOf(context),
        db,
        secret,
        session.personId,
        { label: input.label, days: input.days, scopes: input.scopes },
        currentEnv().POLICY,
        Date.now(),
      );
      return { token: minted.token, label: input.label, expiresAt: minted.expiresAt };
    }),
});
