import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { BACKUP_AGE_CEILING, saveSettings } from '../../db/settings';
import { currentEnv } from '../../lib/env';
import { isTimeZone } from '../../lib/time-zones';
import { act, scopeOf } from '../context';
import { csrfField } from '../inputs';

const HOURS = `Enter whole hours from 1 to ${String(BACKUP_AGE_CEILING)}`;

export default defineAction({
  accept: 'form',
  input: z.object({
    ...csrfField,
    projectNumberRequired: z.boolean(),
    alertTo: z
      .string()
      .trim()
      .max(254)
      .pipe(z.email('Enter an email address, or leave it blank to send no alert'))
      .nullable(),
    timeZone: z
      .string({ error: 'Choose a time zone' })
      .trim()
      .refine(isTimeZone, 'Choose a time zone from the list'),
    backupMaxAgeHours: z
      .number({ error: HOURS })
      .int(HOURS)
      .min(1, HOURS)
      .max(BACKUP_AGE_CEILING, `At most ${String(BACKUP_AGE_CEILING)} hours`),
  }),
  handler: (input, context) =>
    act(async () => {
      const settings = {
        projectNumberRequired: input.projectNumberRequired,
        alertTo: input.alertTo,
        timeZone: input.timeZone,
        backupMaxAgeHours: input.backupMaxAgeHours,
      };
      const written = await saveSettings(scopeOf(context), currentEnv().DB, settings, Date.now());
      return { written };
    }),
});
