import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { clearPendingCodes } from '../../db/pending-codes';
import { authEnv } from '../../lib/env';
import { act, signedIn } from '../context';
import { csrfField } from '../inputs';

/** The person says they saved the new recovery codes; the server forgets the plain copy. */
export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField }),
  handler: (_input, context) =>
    act(async () => {
      await clearPendingCodes(authEnv().db, signedIn(context).personId);
      return { ok: true };
    }),
});
