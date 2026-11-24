import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { createPerson } from '../../db/person-create';
import { currentEnv } from '../../lib/env';
import { fail } from '../../lib/errors';
import { act, scopeOf } from '../context';
import { csrfField, idField, nameField } from '../inputs';

const blank = (v: string | null | undefined) =>
  v === null || v === undefined || v === '' ? undefined : v;

export default defineAction({
  accept: 'form',
  input: z.object({
    ...csrfField,
    name: nameField,
    email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
    externalCode: z.string().trim().max(40).nullish().transform(blank),
    firmId: idField.nullish().transform(blank),
    newFirm: nameField.or(z.literal('')).nullish().transform(blank),
  }),
  handler: (input, context) =>
    act(async () => {
      const { DB, NOTE_KEK } = currentEnv();
      if ((input.firmId === undefined) === (input.newFirm === undefined)) {
        fail('invalid_input', 'choose an existing firm or name a new one');
      }
      const firm =
        input.firmId === undefined ? { newName: input.newFirm ?? '' } : { id: input.firmId };
      const person = {
        name: input.name,
        email: input.email,
        externalCode: input.externalCode ?? null,
        firm,
      };
      return createPerson(scopeOf(context), DB, NOTE_KEK, person, Date.now());
    }),
});
