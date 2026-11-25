// The page a cross-site return lands on. A Strict cookie set by a response the provider's redirect caused would not
// be sent on a 303 to the next page, so the response is a 200 that sets it and moves on with a refresh the
// browser starts from this origin, which carries it. The path is a same-origin one (`safeReturn`).
import { escaped } from './error-responses';

export function handoffPage(next: string, cookies: readonly string[]): Response {
  const to = escaped(next);
  const body = `<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${to}"><title>Signing in · tidwick</title><p>Signing you in. <a href="${to}">Continue</a></p></html>\n`;
  const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' });
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(body, { status: 200, headers });
}
