// Runs third: denies every request the route table does not allow, then attaches the caller's scope for src/db/.
import type { MiddlewareHandler } from 'astro';
import type { Session } from '../auth/session';
import { requireStepUp } from '../auth/step-up';
import { grantsOf, type Grant } from '../db/roles';
import { scopeFor } from '../db/scope';
import { currentEnv } from '../lib/env';
import { fail, isAppError } from '../lib/errors';
import { safeReturn } from '../auth/sso';
import { errorPage, errorResponse, type PageLink } from './error-responses';
import { actionRule, pageRule, type Role, type Rule } from '../routes';

export const RPC_PATTERN = '/_actions/[...path]';
/** The pattern Astro gives a path nobody built; it is answered as not found, with no route-table row to look up. */
const UNBUILT_PATTERN = '/404';
const ACTION_QUERY = '_action';

/**
 * The rows a request must pass, `undefined` standing for a missing row. A script call is judged by its Action
 * alone; a form POST by its Action and the page's GET row, since the page renders the result; anything else by
 * the page's own row. A path and query naming different Actions has no row. Astro's Action client posts the path
 * with a trailing slash and Astro resolves it with that slash removed, so the gate reads the name the same way.
 */
export function rulesFor(pattern: string, method: string, url: URL): (Rule | undefined)[] {
  const query = url.searchParams.get(ACTION_QUERY);
  if (pattern === RPC_PATTERN) {
    const name = url.pathname.replace(/^.*\/_actions\//, '').replace(/\/$/, '');
    if (method !== 'POST' || (query !== null && query !== name)) return [undefined];
    return [actionRule(name)];
  }
  if (method === 'POST' && query !== null) return [actionRule(query), pageRule(pattern, 'GET')];
  return [pageRule(pattern, method)];
}

/** Throws the catalog error that refuses `rule` to this caller: no row, no session, the wrong role, a stale step-up. */
export function authorize(
  rule: Rule | undefined,
  session: Session | null,
  grants: readonly Grant[],
  now: number,
): void {
  if (!rule) fail('forbidden', 'no route table row');
  if (rule.roles.includes('public')) return;
  if (!session) fail('unauthenticated');
  if (session.mustEnrol && !rule.recovery) fail('forbidden', 'add a passkey first');
  const held: readonly Role[] = ['member', ...grants];
  if (!rule.roles.some((role) => held.includes(role))) fail('forbidden');
  // A recovery session proved itself with a code when it began; adding a passkey is how it ends, so age cannot block it.
  if (rule.stepUp && !(session.mustEnrol && rule.recovery)) requireStepUp(session, now);
}

/** A signed-out page request goes to sign-in and comes back to the page; a path that is not a same-origin one is dropped. */
export function signInRedirect(url: URL): Response {
  const back = safeReturn(`${url.pathname}${url.search}`, '');
  const target = back === '' ? '/login' : `/login?return=${encodeURIComponent(back)}`;
  return new Response(null, { status: 303, headers: { location: target } });
}

/** The page that confirms and retries a download, for a stale confirmation on its POST; any other goes to the account. */
const CONFIRM_ON: Readonly<Record<string, PageLink>> = {
  '/export/[client].csv': { href: '/export', label: 'Back to export to confirm' },
  '/reports/[kind].csv': { href: '/reports', label: 'Back to reports to confirm' },
};

export const authz: MiddlewareHandler = async (context, next) => {
  const { DB } = currentEnv();
  const rules = rulesFor(context.routePattern, context.request.method, context.url);
  const session = context.locals.session;
  const gated = session !== null && rules.some((rule) => rule && !rule.roles.includes('public'));
  context.locals.scope = null;
  context.locals.grants = [];
  try {
    if (context.routePattern === UNBUILT_PATTERN) fail('not_found');
    const grants = gated ? await grantsOf(DB, session.personId) : [];
    for (const rule of rules) authorize(rule, session, grants, Date.now());
    context.locals.grants = grants;
    if (gated) context.locals.scope = await scopeFor(DB, session.personId);
  } catch (error) {
    if (!isAppError(error)) throw error;
    if (context.routePattern === RPC_PATTERN) return errorResponse(error.code);
    if (error.code === 'unauthenticated' && ['GET', 'HEAD'].includes(context.request.method))
      return signInRedirect(context.url);
    const confirm = CONFIRM_ON[context.routePattern] ?? {
      href: '/account',
      label: 'Confirm on your account',
    };
    return errorPage(
      context,
      error.code,
      undefined,
      error.code === 'step_up_required' ? confirm : undefined,
    );
  }
  return next();
};
