import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { applyImport } from '../../db/import-apply';
import { currentEnv, noteKeks } from '../../lib/env';
import { act, scopeOf } from '../context';
import { csrfField, csvFileField } from '../inputs';

export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField, file: csvFileField }),
  handler: (input, context) =>
    act(async () => {
      const bytes = new Uint8Array(await input.file.arrayBuffer());
      return applyImport(scopeOf(context), currentEnv().DB, noteKeks(), bytes, Date.now());
    }),
});
