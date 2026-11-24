import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { setProjectTasks } from '../../db/project-tasks';
import { currentEnv } from '../../lib/env';
import { act, scopeOf } from '../context';
import { csrfField, idField } from '../inputs';

export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField, id: idField, taskCodeIds: z.array(idField).max(200) }),
  handler: (input, context) =>
    act(async () => {
      const scope = scopeOf(context);
      await setProjectTasks(scope, currentEnv().DB, input.id, input.taskCodeIds, Date.now());
      return { id: input.id, count: new Set(input.taskCodeIds).size };
    }),
});
