import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { rewrapKeys } from '../../db/key-rewrap';
import { currentEnv, noteKeks } from '../../lib/env';
import { act, scopeOf } from '../context';
import { csrfField } from '../inputs';

export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField }),
  handler: (_input, context) =>
    act(() => rewrapKeys(scopeOf(context), currentEnv().DB, noteKeks(), Date.now())),
});
