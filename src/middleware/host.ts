// Runs after the error boundary: a page, form or agent route answers only on the address `ORIGIN` names, so a second
// hostname for the same Worker (workers.dev beside a custom domain) is a 404 and an edge rule on the custom domain
// cannot be walked around. `/healthz` answers anywhere, and `/setup` keeps its own gate, which tells an operator
// whose `ORIGIN` is not yet this address what to set.
import type { MiddlewareHandler } from 'astro';
import { currentEnv } from '../lib/env';
import { fail } from '../lib/errors';

export const host: MiddlewareHandler = (context, next) => {
  if (context.routePattern === '/setup' || context.routePattern === '/healthz') return next();
  if (context.url.origin !== currentEnv().ORIGIN) fail('not_found');
  return next();
};
