// What every admin-data page needs from the request: the database, the caller's scope and grants, and a way to
// show the outcome of the form that was just posted. Pages call `src/db/`; no SQL is written here.
import type { AstroGlobal } from 'astro';
import { isInputError } from 'astro:actions';
import { grantsOf, isAccounting, isAdmin, isSteward, type Grant } from '../db/roles';
import type { Scope } from '../db/scope';
import { STEP_UP_MS } from '../auth/step-up';
import { currentEnv } from '../lib/env';
import { fail } from '../lib/errors';
import { fieldErrorsOf, type FieldErrors } from '../lib/field-errors';

export interface PageContext {
  db: D1Database;
  scope: Scope;
  personId: string;
  csrf: string;
  grants: Grant[];
  admin: boolean;
  accounting: boolean;
  steward: boolean;
  /** When the caller's passkey confirmation ends, or null when it has lapsed. */
  stepUpUntil: number | null;
}

/** The signed-in caller's context; the route table already admitted them, so a gap here is a bug. */
export async function pageContext(Astro: AstroGlobal): Promise<PageContext> {
  const session = Astro.locals.session ?? fail('unauthenticated');
  const scope = Astro.locals.scope ?? fail('unauthenticated');
  const { DB } = currentEnv();
  const grants = await grantsOf(DB, session.personId);
  return {
    db: DB,
    scope,
    personId: session.personId,
    csrf: Astro.locals.csrf,
    grants,
    admin: isAdmin(grants),
    accounting: isAccounting(grants),
    steward: isSteward(grants),
    stepUpUntil: session.stepUpAt + STEP_UP_MS > Date.now() ? session.stepUpAt + STEP_UP_MS : null,
  };
}

interface Outcome {
  error?: { message: string } | undefined;
}

/** The message to show for the first posted form's error, or null when nothing was posted or it succeeded. */
export function problemOf(results: readonly (Outcome | undefined)[]): string | null {
  const error = results.find((r) => r !== undefined)?.error;
  if (!error) return null;
  if (isInputError(error)) {
    const first = Object.values(error.fields).flat()[0];
    return first ?? 'Check the form and try again.';
  }
  return error.message;
}

/** The address a page redirects to after a form succeeded, marked so the page shows one line saying it did. */
export function savedAt(path: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}saved=1`;
}

/** Whether some posted form succeeded, so the page can redirect and a refresh never reposts it. */
export function succeeded(results: readonly (Outcome | undefined)[]): boolean {
  const posted = results.find((r) => r !== undefined);
  return posted !== undefined && !posted.error;
}

/** What the first posted form says about each of its fields, for the page to show beside them; none when it passed. */
export function fieldErrors(results: readonly (Outcome | undefined)[]): FieldErrors {
  const error = results.find((r) => r !== undefined)?.error;
  return error && isInputError(error) ? fieldErrorsOf(error.fields) : {};
}

/**
 * The text fields of the form that was just posted, so a refused form keeps what was typed. Empty when the body
 * is gone or is not a form; never throws.
 */
export async function postedFields(Astro: AstroGlobal): Promise<Record<string, string>> {
  if (Astro.request.method !== 'POST') return {};
  try {
    const form = await Astro.request.clone().formData();
    const kept: Record<string, string> = {};
    for (const [name, value] of form.entries()) {
      if (typeof value === 'string' && name !== '_csrf') kept[name] = value;
    }
    return kept;
  } catch {
    return {};
  }
}
