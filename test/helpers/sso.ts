// The browser's side of a single sign-on flow against the built Worker, with `mockIdp` as the provider.
import { env, exports } from 'cloudflare:workers';
import { expect } from 'vitest';
import { SSO_COOKIE } from '../../src/auth/sso';
import { SESSION_COOKIE } from '../../src/auth/session';
import { readEnv } from '../../src/lib/env';
import type { SsoProvider } from '../../src/lib/sso-config';
import { addPerson, withIdentity } from './auth';
import { ORIGIN, type Caller } from './callers';
import { mockIdp, type MockIdp, type MockIssuer, type MockLogin } from './mock-idp';

export const providers = (): readonly SsoProvider[] => readEnv(env).SSO;

export function provider(id: string): SsoProvider {
  const found = providers().find((p) => p.id === id);
  if (!found) throw new Error(`no test provider ${id}`);
  return found;
}

/** The mock provider for every configured one, answering at its issuer with its client id and secret. */
export function idpForConfigured(): Promise<MockIdp> {
  const issuers: MockIssuer[] = providers().map((p) => ({
    issuer: p.issuer,
    clientId: p.clientId,
    secret: p.clientSecret,
  }));
  return mockIdp(issuers);
}

/** A `Set-Cookie` header's value for `name`, or null when it is not set (an empty value, a cleared cookie, is ''). */
export function setCookie(response: Response, name: string): string | null {
  for (const line of response.headers.getSetCookie()) {
    if (line.startsWith(`${name}=`)) return line.slice(name.length + 1).split(';')[0] ?? '';
  }
  return null;
}

export interface Started {
  response: Response;
  /** The provider's address, or '' when the route did not redirect. */
  location: string;
  /** The flow cookie's value, which is also `state`. */
  flow: string | null;
}

export async function get(
  path: string,
  cookies: string[] = [],
  extra: Record<string, string> = {},
): Promise<Response> {
  const headers = new Headers(extra);
  if (cookies.length > 0) headers.set('cookie', cookies.join('; '));
  return exports.default.fetch(new Request(`${ORIGIN}${path}`, { headers, redirect: 'manual' }));
}

const sessionOf = (who: Caller | null): string[] => (who ? [`${SESSION_COOKIE}=${who.raw}`] : []);

/** Starts a flow at one of the `/auth/sso/*` start routes. */
export async function start(path: string, who: Caller | null = null): Promise<Started> {
  const response = await get(path, sessionOf(who));
  return {
    response,
    location: response.headers.get('location') ?? '',
    flow: setCookie(response, SSO_COOKIE),
  };
}

/** The provider's redirect back, with the flow cookie the browser held (none when `flow` is null). */
export function callback(url: string, flow: string | null): Promise<Response> {
  const { pathname, search } = new URL(url);
  return get(`${pathname}${search}`, flow === null ? [] : [`${SSO_COOKIE}=${flow}`]);
}

/** A caller for the session a callback opened, so it can request pages as that person. */
export function signedInAs(response: Response, personId: string): Caller {
  const raw = setCookie(response, SESSION_COOKIE);
  if (raw === null || raw === '') throw new Error('the callback opened no session');
  return { personId, raw, token: '' };
}

/** Links an identity to a person at a configured provider; returns its id. */
export const link = (
  personId: string,
  providerId: string,
  subject: string,
  email: string | null = null,
): Promise<string> => withIdentity(personId, provider(providerId).issuer, subject, email);

/** A whole sign-in at a start route: the redirect out, the provider's answer for `login`, the callback's response. */
export async function through(
  idp: MockIdp,
  path: string,
  login: MockLogin,
  who: Caller | null = null,
): Promise<Response> {
  const begun = await start(path, who);
  if (begun.location === '' || begun.location.startsWith('/login')) return begun.response;
  return callback(idp.authorize(begun.location, login), begun.flow);
}

export const LOGIN = '/auth/sso/login?provider=tenant-a';
export const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/** A person already linked at tenant A as `subject`. */
export async function linked(subject: string): Promise<string> {
  const { id } = await addPerson();
  await link(id, 'tenant-a', subject);
  return id;
}

let serial = 0;
/** A subject no other case has used, linked to a new person. */
export async function someone(): Promise<string> {
  const subject = `subject-${String((serial += 1))}`;
  await linked(subject);
  return subject;
}

/** The callback for a login as `login`, after `tamper` has changed the address or the cookie the browser sends. */
export async function attempt(
  idp: MockIdp,
  login: MockLogin,
  tamper: (url: string, flow: string | null) => [string, string | null] = (u, f) => [u, f],
  path = LOGIN,
): Promise<Response> {
  const begun = await start(path);
  const [url, flow] = tamper(idp.authorize(begun.location, login), begun.flow);
  return callback(url, flow);
}

/** What a refusal must never have done: a session, or a flow cookie left set. */
export function refused(response: Response, status: number): void {
  expect(response.status).toBe(status);
  expect(setCookie(response, SESSION_COOKIE)).toBeNull();
  expect(setCookie(response, SSO_COOKIE)).toBe('');
}
