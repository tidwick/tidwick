import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { throttleAgent } from '../../auth/rate-limit';
import { guardPersona } from '../../auth/demo';
import { currentEnv } from '../../lib/env';
import { fail } from '../../lib/errors';
import { readAuthorize, returnAddress, TOOL_SCOPES } from '../../oauth/authorize';
import { OauthError } from '../../oauth/error';
import { grantAccess } from '../../oauth/grant';
import { act, scopeOf, signedIn } from '../context';
import { csrfField } from '../inputs';

// Approving a client's request. The request is read again from the address the form posted to, so the page's word is
// never taken; the code goes back only in this result, which the page turns into a hand-off to the client.
export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField, scopes: z.array(z.enum(TOOL_SCOPES)).default([]) }),
  handler: (input, context) =>
    act(async () => {
      const env = currentEnv();
      if (!env.MCP) fail('not_found');
      const session = signedIn(context);
      await guardPersona(env, session.personId);
      await throttleAgent(env.RATE_LIMIT, env.SESSION_SECRET, { person: session.personId });
      let request;
      try {
        request = await readAuthorize(context.url.searchParams, env);
      } catch (error) {
        if (error instanceof OauthError) fail('invalid_input', error.message);
        throw error;
      }
      const scopes = request.offered.filter((s) => input.scopes.includes(s));
      if (scopes.length === 0) fail('invalid_input', 'tick at least one thing the agent may do');
      const code = await grantAccess(
        scopeOf(context),
        env.DB,
        env.SESSION_SECRET,
        session.personId,
        request,
        scopes,
        env.POLICY.agentTokenMax,
        Date.now(),
      );
      return {
        location: returnAddress(request, env.ORIGIN, { code }),
        client: request.client.name,
        host: new URL(request.redirectUri).host,
      };
    }),
});
