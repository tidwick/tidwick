import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { previewImport } from '../../db/import-apply';
import { currentEnv } from '../../lib/env';
import { act, scopeOf } from '../context';
import { csrfField, csvFileField } from '../inputs';

export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField, file: csvFileField }),
  handler: (input, context) =>
    act(async () =>
      previewImport(
        scopeOf(context),
        currentEnv().DB,
        new Uint8Array(await input.file.arrayBuffer()),
      ),
    ),
});
