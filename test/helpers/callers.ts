// Requests through the built Worker as a signed-in person, for the `app` project's middleware tests.
import { env, exports } from 'cloudflare:workers';
import { newSession } from '../../src/auth/session';
import { csrfToken } from '../../src/auth/tokens';
import type { Grant } from '../../src/db/roles';
import { currentEnv } from '../../src/lib/env';
import { addPerson } from './auth';
import { DEFAULT_POLICY } from '../../src/lib/policy';

export const ORIGIN = 'http://localhost:4321';

export interface Caller {
  readonly personId: string;
  readonly raw: string;
  readonly token: string;
}

/** A fresh person with these grants and a session; `stepUpAgo` backdates the session's last assertion. */
export async function caller(
  grants: readonly Grant[] = [],
  options: { mustEnrol?: boolean; stepUpAgo?: number } = {},
): Promise<Caller> {
  const { SESSION_SECRET } = currentEnv();
  const person = await addPerson(grants);
  const at = Date.now() - (options.stepUpAgo ?? 0);
  const session = await newSession(
    env.DB,
    SESSION_SECRET,
    person.id,
    at,
    DEFAULT_POLICY.sessionMaxMs,
    options.mustEnrol,
  );
  await session.statement.run();
  const token = await csrfToken(SESSION_SECRET, session.rawId);
  return { personId: person.id, raw: session.rawId, token };
}

function headers(who: Caller | null, type?: string): Headers {
  const h = new Headers({ origin: ORIGIN });
  if (type) h.set('content-type', type);
  if (who) h.set('cookie', `__Host-tidwick-session=${who.raw}`);
  return h;
}

export function getPage(path: string, who: Caller | null): Promise<Response> {
  return exports.default.fetch(
    new Request(`${ORIGIN}${path}`, { headers: headers(who), redirect: 'manual' }),
  );
}

/** The script caller: POST `/_actions/<name>` with a JSON body carrying the token. */
export function rpc(name: string, who: Caller | null, body: object = {}): Promise<Response> {
  const json = JSON.stringify(who ? { _csrf: who.token, ...body } : body);
  return exports.default.fetch(
    new Request(`${ORIGIN}/_actions/${name}`, {
      method: 'POST',
      headers: headers(who, 'application/json'),
      body: json,
    }),
  );
}

export type Fields = Record<string, string | readonly string[]>;

function encoded(who: Caller | null, fields: Fields): string {
  const body = new URLSearchParams(who ? { _csrf: who.token } : {});
  for (const [key, value] of Object.entries(fields)) {
    for (const one of typeof value === 'string' ? [value] : value) body.append(key, one);
  }
  return body.toString();
}

/** The no-script caller: POST a form to `page?_action=<name>`. */
export function formPost(
  page: string,
  name: string | null,
  who: Caller | null,
  fields: Fields = {},
): Promise<Response> {
  const query = name === null ? '' : `?_action=${name}`;
  return exports.default.fetch(
    new Request(`${ORIGIN}${page}${query}`, {
      method: 'POST',
      headers: headers(who, 'application/x-www-form-urlencoded'),
      body: encoded(who, fields),
      redirect: 'manual',
    }),
  );
}

/** The script caller for an Action that takes form data: POST `/_actions/<name>` as a urlencoded form. */
export function rpcForm(name: string, who: Caller | null, fields: Fields = {}): Promise<Response> {
  return exports.default.fetch(
    new Request(`${ORIGIN}/_actions/${name}`, {
      method: 'POST',
      headers: headers(who, 'application/x-www-form-urlencoded'),
      body: encoded(who, fields),
    }),
  );
}

/** The island's call: POST `/_actions/<name>/` with a multipart body, the path and body Astro's Action client sends for FormData. */
export function rpcMultipart(
  name: string,
  who: Caller | null,
  fields: Fields = {},
): Promise<Response> {
  const form = new FormData();
  if (who) form.set('_csrf', who.token);
  for (const [key, value] of Object.entries(fields)) {
    for (const one of typeof value === 'string' ? [value] : value) form.append(key, one);
  }
  const headers = new Headers({ origin: ORIGIN });
  if (who) headers.set('cookie', `__Host-tidwick-session=${who.raw}`);
  return exports.default.fetch(
    new Request(`${ORIGIN}/_actions/${name}/`, { method: 'POST', headers, body: form }),
  );
}

/** The island or script caller for an Action that takes a file: POST `/_actions/<name>` as multipart with one file field. */
export function rpcFile(
  name: string,
  who: Caller | null,
  file: File | string,
  fields: Fields = {},
): Promise<Response> {
  const form = new FormData();
  if (who) form.set('_csrf', who.token);
  for (const [key, value] of Object.entries(fields)) {
    for (const one of typeof value === 'string' ? [value] : value) form.append(key, one);
  }
  form.set('file', file);
  const headers = new Headers({ origin: ORIGIN });
  if (who) headers.set('cookie', `__Host-tidwick-session=${who.raw}`);
  return exports.default.fetch(
    new Request(`${ORIGIN}/_actions/${name}/`, { method: 'POST', headers, body: form }),
  );
}
