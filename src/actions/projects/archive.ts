import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { archiveProject } from '../../db/projects';
import { currentEnv } from '../../lib/env';
import { act, scopeOf } from '../context';
import { csrfField, idField, restoreField } from '../inputs';

export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField, id: idField, restore: restoreField }),
  handler: (input, context) =>
    act(async () => {
      const scope = scopeOf(context);
      await archiveProject(scope, currentEnv().DB, input.id, input.restore, Date.now());
      return { id: input.id, archived: !input.restore };
    }),
});
