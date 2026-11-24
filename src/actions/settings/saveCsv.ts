import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { saveCsvMappings } from '../../db/csv-settings';
import { exportMapping, importMapping } from '../../lib/csv-mapping';
import { currentEnv } from '../../lib/env';
import { act, scopeOf } from '../context';
import { csrfField, jsonField } from '../inputs';

export default defineAction({
  accept: 'form',
  input: z.object({
    ...csrfField,
    exportMapping: jsonField(exportMapping, 'Export mapping'),
    importMapping: jsonField(importMapping, 'Import mapping'),
  }),
  handler: (input, context) =>
    act(async () => {
      await saveCsvMappings(
        scopeOf(context),
        currentEnv().DB,
        { export: input.exportMapping, import: input.importMapping },
        Date.now(),
      );
      return { saved: true };
    }),
});
