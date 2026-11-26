// Runs first: an error any later gate or page throws leaves as the catalog's page or JSON body, never Astro's
// default 500, and the log gets only `errorText()`, so no message, stack or value reaches either.
import type { MiddlewareHandler } from 'astro';
import { errorText } from '../lib/error-text';
import { isAppError } from '../lib/errors';
import { errorPage, errorResponse } from './error-responses';
import { RPC_PATTERN } from './authz';
import { MCP_PATTERN, rpcRefusal } from './mcp-responses';

export const errors: MiddlewareHandler = async (context, next) => {
  try {
    return await next();
  } catch (error) {
    const known = isAppError(error) ? error : null;
    if (known === null || known.status >= 500)
      console.error('tidwick: request failed:', errorText(error));
    const code = known?.code ?? 'internal';
    if (context.routePattern === MCP_PATTERN) return rpcRefusal(code);
    return context.routePattern === RPC_PATTERN ? errorResponse(code) : errorPage(context, code);
  }
};
