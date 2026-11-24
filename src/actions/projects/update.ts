import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { updateProject } from '../../db/projects';
import { currentEnv } from '../../lib/env';
import { act, scopeOf } from '../context';
import { csrfField, idField, nameField, numberField } from '../inputs';

export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField, id: idField, name: nameField, number: numberField }),
  handler: (input, context) =>
    act(async () => {
      const { id, ...project } = input;
      await updateProject(scopeOf(context), currentEnv().DB, id, project, Date.now());
      return { id };
    }),
});
