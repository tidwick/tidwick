// Catalog errors as Astro Actions errors, JSON bodies and bare pages: the edge half of the catalog in src/lib/errors.ts.
import type { APIContext } from 'astro';
import { ActionError } from 'astro:actions';
import { isAccounting, isAdmin, type Grant } from '../db/roles';
import { AppError, CATALOG, errorMessage, type ErrorCode } from '../lib/errors';

/**
 * At the Action boundary: a catalog error becomes Astro's ActionError with its status and message, and any other
 * error becomes the catalog's `internal` entry, so a database or crypto message never reaches the caller.
 */
export function forAction(error: unknown): ActionError {
  const known = error instanceof AppError ? error : new AppError('internal');
  return new ActionError({ code: ActionError.statusToCode(known.status), message: known.message });
}

/**
 * A catalog error as a JSON response, for middleware that refuses a request before any route runs. The body is
 * Astro's `AstroActionError` as well (`type`, `code`, `status`, `message`), so the client built for a refused
 * `/_actions/` call carries the catalog message; `error` is the catalog code.
 */
export function errorResponse(code: ErrorCode): Response {
  const { status, message } = CATALOG[code];
  const body = {
    type: 'AstroActionError',
    code: ActionError.statusToCode(status),
    status,
    error: code,
    message,
  };
  return Response.json(body, { status });
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
export const escaped = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);

/** Where a refused page sends the person next, when that is not their account or the sign-in page. */
export interface PageLink {
  href: string;
  label: string;
}

/** What `src/pages/error.astro` shows: the catalog error and the one link that moves the person on. */
export interface Refusal {
  code: ErrorCode;
  detail: string | undefined;
  back: PageLink | undefined;
}

export const ERROR_PATH = '/error';

/** The page a refused person lands on: signed out the sign-in page, otherwise the first page their roles open. */
export function homeFor(signedIn: boolean, mustEnrol: boolean, grants: readonly Grant[]): PageLink {
  if (!signedIn) return { href: '/login', label: 'Sign in' };
  if (mustEnrol) return { href: '/account', label: 'Go to your account' };
  if (isAccounting(grants)) return { href: '/approvals', label: 'Go to approvals' };
  if (isAdmin(grants)) return { href: '/admin/people', label: 'Go to people' };
  return { href: '/week', label: 'Go to your week' };
}

type Refuser = Pick<APIContext, 'locals' | 'request' | 'rewrite' | 'routePattern' | 'url'>;

/**
 * A catalog error as a page for a browser: the request is rewritten to `/error`, which renders the message in
 * the app's own frame with the status of `code` and the one link that moves the person on, `back` when the
 * caller names one. A refusal raised while `/error` itself renders gets the bare page, so it cannot loop.
 */
export async function errorPage(
  context: Refuser,
  code: ErrorCode,
  detail?: string,
  back?: PageLink,
): Promise<Response> {
  if (context.routePattern === ERROR_PATH) return plainPage(code, detail);
  context.locals.refusal = { code, detail, back };
  return context.rewrite(
    new Request(new URL(ERROR_PATH, context.url), { headers: context.request.headers }),
  );
}

function plainPage(code: ErrorCode, detail: string | undefined): Response {
  const { status } = CATALOG[code];
  const message = escaped(errorMessage(code, detail));
  const body = `<!doctype html><html lang="en"><meta charset="utf-8"><title>${message} · tidwick</title><p>${message}.</p><p><a href="/">Home</a></p></html>\n`;
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}
