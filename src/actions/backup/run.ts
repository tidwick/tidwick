import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { backUpNow } from '../../backup/run-now';
import { currentBackupEnv } from '../../lib/env';
import { act, scopeOf } from '../context';
import { csrfField } from '../inputs';

export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField }),
  handler: (_input, context) =>
    act(async () => {
      const run = await backUpNow(scopeOf(context), currentBackupEnv(), Date.now());
      return { status: run.status, objectKey: run.object_key, error: run.error };
    }),
});
