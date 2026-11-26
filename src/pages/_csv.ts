// What the two CSV download routes share: read the posted range, run the builder, answer as an attachment, and
// turn a catalog error into a page naming the reason with a link back to the form, since only a browser form posts
// here. The route table has already required the role and step-up.
import type { APIContext } from 'astro';
import type { CsvFile } from '../db/exports';
import type { Scope } from '../db/scope';
import { currentEnv, noteKeks } from '../lib/env';
import { parseRange, type DateRange } from '../lib/date-range';
import { fail, isAppError } from '../lib/errors';
import { errorPage, type PageLink } from '../middleware/error-responses';
import type { NoteKeks } from '../lib/note-crypto';
import { csvDownload } from '../headers';

export async function csvEndpoint(
  context: APIContext,
  back: PageLink,
  build: (scope: Scope, range: DateRange) => Promise<CsvFile>,
): Promise<Response> {
  try {
    const scope = context.locals.scope ?? fail('unauthenticated');
    const form = await context.request.formData();
    const file = await build(
      scope,
      parseRange(form.get('from'), form.get('to'), currentEnv().POLICY.reportMaxDays),
    );
    return csvDownload(file.text, file.filename);
  } catch (error) {
    if (isAppError(error)) return errorPage(context, error.code, error.detail, back);
    throw error;
  }
}

/** The database and note keys for a builder. */
export const csvEnv = (): { db: D1Database; keks: NoteKeks } => ({
  db: currentEnv().DB,
  keks: noteKeks(),
});
