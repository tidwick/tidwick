import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { claimFirstAdmin } from '../../auth/setup-claim';
import { currentEnv } from '../../lib/env';
import { act, throttled } from '../context';
import { csrfField } from '../inputs';

const text = z.string().trim().min(1).max(200);

export default defineAction({
  accept: 'form',
  input: z.object({
    ...csrfField,
    token: z.string().trim().max(512),
    email: z.string().trim().toLowerCase().max(254),
    name: text,
    firm: text,
  }),
  handler: (input, context) =>
    act(async () => {
      const deps = await throttled(context, 'login');
      const env = currentEnv();
      const { token, ...who } = input;
      return claimFirstAdmin(
        { ...deps, kek: env.NOTE_KEK, setupToken: env.SETUP_TOKEN },
        token,
        { email: who.email, name: who.name, firm: who.firm },
        Date.now(),
      );
    }),
});
