// A request context for the unit tests of `errorPage`, whose `rewrite` answers with the bare page the real one falls
// back to, so a test reads the refusal the page would carry without booting the Worker.
import type { APIContext } from 'astro';
import { errorPage } from '../../src/middleware/error-responses';

export function refusalContext(
  pattern = '/week/[...start]',
  path = '/week',
  method = 'GET',
): APIContext {
  const request = new Request(new URL(path, 'http://localhost'), { method });
  const context = {
    routePattern: pattern,
    request,
    url: new URL(request.url),
    locals: {},
    rewrite: () => {
      const { code, detail } = (context.locals as App.Locals).refusal ?? {
        code: 'internal' as const,
      };
      return errorPage(
        { ...context, routePattern: '/error' } as unknown as APIContext,
        code,
        detail,
      );
    },
  };
  return context as unknown as APIContext;
}
