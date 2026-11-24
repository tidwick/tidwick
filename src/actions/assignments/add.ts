import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { addAssignment } from '../../db/assignments';
import { currentEnv } from '../../lib/env';
import { act, scopeOf } from '../context';
import { csrfField, idField } from '../inputs';

export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField, projectId: idField, personId: idField }),
  handler: (input, context) =>
    act(async () => {
      const { DB } = currentEnv();
      await addAssignment(scopeOf(context), DB, input.projectId, input.personId, Date.now());
      return { projectId: input.projectId, personId: input.personId };
    }),
});
