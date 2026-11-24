// What a browser does that a test's own fetch does not: it derives a form POST's Origin from the page's policy.
import { exports } from 'cloudflare:workers';
import type { Caller } from './callers';
import { ORIGIN } from './callers';

/**
 * The `Origin` a browser puts on a same-origin form POST from a page served with this response. The Fetch spec
 * serialises it as `null` under a `no-referrer` policy and as the page's origin under any other.
 */
export function formOriginFor(page: Response, pageOrigin: string): string {
  const listed = (page.headers.get('referrer-policy') ?? '').split(',').map((p) => p.trim());
  const policy = listed.reverse().find((p) => p !== '') ?? 'strict-origin-when-cross-origin';
  return policy === 'no-referrer' ? 'null' : pageOrigin;
}

export interface BrowserPost {
  readonly page: Response;
  readonly sent: string;
  readonly response: Response;
}

/**
 * GETs a page, then POSTs a form to it the way Chrome does: `?_action=<name>` on the page's URL, the `Origin` its
 * policy yields, the session cookie and the person's token. Nothing in the request is set to what the Worker wants.
 */
export async function browserFormPost(
  path: string,
  action: string,
  who: Pick<Caller, 'raw' | 'token'> | null,
  fields: Record<string, string> = {},
): Promise<BrowserPost> {
  const cookie = who ? { cookie: `__Host-tidwick-session=${who.raw}` } : {};
  const page = await exports.default.fetch(new Request(`${ORIGIN}${path}`, { headers: cookie }));
  const sent = formOriginFor(page, ORIGIN);
  const body = new URLSearchParams(who ? { _csrf: who.token, ...fields } : fields).toString();
  const response = await exports.default.fetch(
    new Request(`${ORIGIN}${path}?_action=${action}`, {
      method: 'POST',
      headers: { ...cookie, origin: sent, 'content-type': 'application/x-www-form-urlencoded' },
      body,
      redirect: 'manual',
    }),
  );
  return { page, sent, response };
}
