import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { requireStepUp } from '../../auth/step-up';
import { guardPersona } from '../../auth/demo';
import { updatePerson } from '../../db/person-update';
import { currentEnv } from '../../lib/env';
import { act, scopeOf, signedIn } from '../context';
import { csrfField, idField, nameField } from '../inputs';

const blank = (v: string | null | undefined) =>
  v === null || v === undefined || v === '' ? null : v;

/** An admin edits a person; changing the email needs a fresh passkey confirmation, the rest does not. */
export default defineAction({
  accept: 'form',
  input: z.object({
    ...csrfField,
    id: idField,
    name: nameField,
    email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
    externalCode: z.string().trim().max(40).nullish().transform(blank),
    firmId: idField,
  }),
  handler: (input, context) =>
    act(async () => {
      await guardPersona(currentEnv(), input.id);
      const now = Date.now();
      const session = signedIn(context);
      const edit = { ...input, externalCode: input.externalCode ?? null };
      await updatePerson(scopeOf(context), currentEnv().DB, input.id, edit, now, (emailChanges) => {
        if (emailChanges) requireStepUp(session, now, currentEnv().POLICY.stepUpMs);
      });
      return { id: input.id };
    }),
});
