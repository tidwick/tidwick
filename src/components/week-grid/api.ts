// The island's calls to the week Actions. Each posts the same form fields the no-script form posts and
// returns the canonical week, or the message to show; a catalog error already carries its plain-words message.
import { actions, isInputError } from 'astro:actions';
import type { LoadedWeek } from '../../lib/week';

export type Outcome = { ok: true; week: LoadedWeek } | { ok: false; message: string };

interface Result {
  data?: LoadedWeek | undefined;
  error?: { message: string; status?: number | undefined } | undefined;
}

function toForm(fields: Readonly<Record<string, string>>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

/** What to say when a refusal arrives with no words: Astro builds an empty message for a body it cannot read. */
function unsaid(status: number | undefined): string {
  if (status === 401) return 'Your session has ended; sign in again.';
  if (status === 403)
    return "That was refused; reload the page, and to change another person's week confirm with your passkey on your account page.";
  return 'Something went wrong; try again.';
}

function outcome({ data, error }: Result): Outcome {
  if (data) return { ok: true, week: data };
  if (error && isInputError(error)) {
    const first = Object.values(error.fields).flat()[0] ?? error.issues[0]?.message;
    return { ok: false, message: first ?? 'Check the week and try again.' };
  }
  const said = error?.message ?? '';
  return { ok: false, message: said === '' ? unsaid(error?.status) : said };
}

async function call(
  action: (form: FormData) => Promise<Result>,
  fields: Record<string, string>,
): Promise<Outcome> {
  try {
    return outcome(await action(toForm(fields)));
  } catch {
    return {
      ok: false,
      message: 'The server could not be reached; check the connection and try again.',
    };
  }
}

export interface Base {
  csrf: string;
  weekStart: string;
}

const base = ({ csrf, weekStart }: Base) => ({ _csrf: csrf, weekStart });

export const saveCells = (b: Base, cells: Record<string, string>) =>
  call(actions.entries.save, { ...base(b), ...cells });

/** An accounting admin's save to another person's week, through the lock. */
export const saveCellsFor = (b: Base, personId: string, cells: Record<string, string>) =>
  call(actions.entriesFor.save, { ...base(b), personId, ...cells });

/** Submits the week the owner confirmed: refused if its entries changed since `fingerprint` was read. */
export const submitWeek = (b: Base, fingerprint: string) =>
  call(actions.submission.submit, { ...base(b), fingerprint });

export const addRow = (b: Base, projectId: string, taskCodeId: string) =>
  call(actions.entries.addRow, { ...base(b), projectId, taskCodeId });

export const removeRow = (b: Base, rowId: string) =>
  call(actions.entries.removeRow, { ...base(b), rowId });

export const copyLastWeek = (b: Base) => call(actions.entries.copyLastWeek, base(b));
