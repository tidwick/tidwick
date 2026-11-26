// Zod pieces more than one Action's input uses. SimpleWebAuthn checks a credential response in full.
import { z } from 'astro/zod';
import { pathText } from '../lib/field-errors';
import { parseFingerprint, type Fingerprint } from '../lib/fingerprint';
import { MAX_IMPORT_BYTES } from '../lib/import';
import { MAX_WEEK_ROWS } from '../lib/limits';
import { DAYS_IN_WEEK, isWeekStart } from '../lib/week';
import { readCells, type CellEdit } from '../lib/week-form';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '../auth/webauthn';

/** The synchronizer token; the CSRF middleware checks it before the Action runs, the handler ignores it. */
export const csrfField = { _csrf: z.string().max(128).optional() };

/** The longest credential id, in base64url characters, that enrolment, add, sign-in and removal accept. */
export const MAX_CREDENTIAL_ID = 1024;

/** A stored credential id as the account page posts it back for removal. */
export const credentialIdField = z.string().trim().min(1).max(MAX_CREDENTIAL_ID);

function isCredentialJson(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    v.id.length <= MAX_CREDENTIAL_ID &&
    typeof v.rawId === 'string' &&
    v.type === 'public-key' &&
    typeof v.response === 'object' &&
    v.response !== null
  );
}

export const registrationJson = z.custom<RegistrationResponseJSON>(isCredentialJson);
export const authenticationJson = z.custom<AuthenticationResponseJSON>(isCredentialJson);

/** A row id as it arrives from a form: opaque text, checked against the database by the handler. */
export const idField = z.string().trim().min(1).max(64);

/** A label for a client, project, task code, firm or person. */
export const nameField = z.string().trim().min(1, 'Enter a name').max(120);

/** The project number as typed: blank for none, else YY-NNNN (the handler and the schema check it again). */
export const numberField = z
  .string()
  .trim()
  .max(7)
  .regex(/^([0-9]{2}-[0-9]{4})?$/, 'Use the form YY-NNNN, such as 26-0001')
  .nullish()
  .transform((value) => value ?? '');

/** A checkbox or button that restores instead of archives; absent means archive. */
export const restoreField = z
  .enum(['1'])
  .nullish()
  .transform((value) => value === '1');

/** The Monday a week starts on, as a civil date. */
export const weekStartField = z
  .string()
  .trim()
  .refine(isWeekStart, 'Choose a week that starts on a Monday');

/** The fingerprint of the week a form was drawn from; blank or absent means no check, text that is not one is refused. */
export const fingerprintField = z
  .string()
  .trim()
  .max(60)
  .nullish()
  .transform((text, ctx): Fingerprint | null => {
    if (text === undefined || text === null || text === '') return null;
    const print = parseFingerprint(text);
    if (print !== null) return print;
    ctx.addIssue({ code: 'custom', message: 'Reload the week and try again' });
    return z.NEVER;
  });

/** Why an approver returns a week, in a line the owner will read. */
export const returnReasonField = z
  .string()
  .trim()
  .min(1, 'Say why the week is returned')
  .max(500, 'Keep the reason under 500 characters');

const MAX_CELLS = MAX_WEEK_ROWS * DAYS_IN_WEEK;

/** The `cell.*` fields of a whole-week save as edits, and the problems its schema reports: unreadable cells, too many. */
export function weekCells(fields: Readonly<Record<string, string>>): {
  edits: CellEdit[];
  problems: string[];
} {
  const { edits, problems } = readCells(fields);
  if (edits.length > MAX_CELLS) problems.push('Too many cells in one save');
  return { edits, problems };
}

/** The CSV an admin uploads: a real file, not empty, at most the import's size cap. */
export const csvFileField = z
  .instanceof(File, { message: 'Choose a CSV file to upload' })
  .refine((file) => file.size > 0, 'The file is empty')
  .refine((file) => file.size <= MAX_IMPORT_BYTES, 'The file is over 2 MB; split it by date range');

const MAX_ISSUES_SHOWN = 5;

/** A JSON document typed into a textarea, parsed and checked by `schema`; the message names which one is wrong. */
export function jsonField<T extends z.ZodType>(schema: T, label: string) {
  return z
    .string()
    .max(20_000, `${label} is too long`)
    .transform((text, ctx): z.infer<T> => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        ctx.addIssue({ code: 'custom', message: `${label} is not valid JSON` });
        return z.NEVER;
      }
      const result = schema.safeParse(parsed);
      if (!result.success) {
        for (const issue of result.error.issues.slice(0, MAX_ISSUES_SHOWN)) {
          const where = pathText(issue.path);
          ctx.addIssue({
            code: 'custom',
            message: `${label}${where ? ` (${where})` : ''}: ${issue.message}`,
          });
        }
        return z.NEVER;
      }
      return result.data;
    });
}
