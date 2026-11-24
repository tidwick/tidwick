import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { createProject } from '../../db/projects';
import { currentEnv } from '../../lib/env';
import { act, scopeOf } from '../context';
import { csrfField, idField, nameField, numberField } from '../inputs';

export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField, clientId: idField, name: nameField, number: numberField }),
  handler: (input, context) =>
    act(async () => {
      const { clientId, ...project } = input;
      const created = await createProject(
        scopeOf(context),
        currentEnv().DB,
        clientId,
        project,
        Date.now(),
      );
      return { id: created.id, clientId };
    }),
});
