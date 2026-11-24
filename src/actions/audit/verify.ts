import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { verifyAudit } from '../../db/audit-verify';
import { currentEnv } from '../../lib/env';
import { act, scopeOf } from '../context';
import { csrfField } from '../inputs';

export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField }),
  handler: (_input, context) => act(() => verifyAudit(scopeOf(context), currentEnv().DB)),
});
