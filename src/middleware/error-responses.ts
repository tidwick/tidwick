// Catalog errors as Astro Actions errors, JSON bodies and bare pages: the edge half of the catalog in src/lib/errors.ts.
import { ActionError } from 'astro:actions';
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
const escaped = (text: string): string => text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);

/** Where a refused page sends the person next, when that is not their account or the sign-in page. */
export interface PageLink {
  href: string;
  label: string;
}

/**
 * A catalog error as a bare page for a browser: the message with its detail, and the one link that moves the
 * person on, `back` when the caller names one.
 */
export function errorPage(code: ErrorCode, detail?: string, back?: PageLink): Response {
  const { status } = CATALOG[code];
  const message = escaped(errorMessage(code, detail));
  const link =
    back ??
    (code === 'unauthenticated'
      ? { href: '/login', label: 'Sign in' }
      : { href: '/account', label: 'Go to your account' });
  const body = `<!doctype html><html lang="en"><meta charset="utf-8"><title>${message} · tidwick</title><p>${message}.</p><p><a href="${escaped(link.href)}">${escaped(link.label)}</a></p></html>\n`;
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}
