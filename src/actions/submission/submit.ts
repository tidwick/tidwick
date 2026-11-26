import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { fingerprintText } from '../../lib/fingerprint';
import { submitWeek, weekFingerprint } from '../../db/submissions';
import { currentEnv } from '../../lib/env';
import { fail } from '../../lib/errors';
import { act, scopeOf } from '../context';
import { csrfField, fingerprintField, weekStartField } from '../inputs';
import { ownWeek } from '../own-week';
import { saveTypedCells } from '../typed-cells';

/** The week, the fingerprint it was drawn with, and, with no script, the cells typed since: any other field is a string. */
const input = z
  .object({ ...csrfField, weekStart: weekStartField, fingerprint: fingerprintField })
  .catchall(z.string());

export default defineAction({
  accept: 'form',
  input,
  handler: (input, context) =>
    act(async () => {
      const scope = scopeOf(context);
      const db = currentEnv().DB;
      const person = scope.actorId ?? fail('forbidden');
      let seen = input.fingerprint;
      // Typing moves the fingerprint, so the one the person saw is checked before their cells are saved, and
      // the submit then carries the one their save left.
      const now = await weekFingerprint(scope, db, person, input.weekStart);
      if (seen && fingerprintText(now) !== fingerprintText(seen)) fail('conflict');
      if (await saveTypedCells(context, input.weekStart, input)) {
        seen = await weekFingerprint(scope, db, person, input.weekStart);
      }
      await submitWeek(scope, db, input.weekStart, Date.now(), seen);
      return ownWeek(context, input.weekStart);
    }),
});
