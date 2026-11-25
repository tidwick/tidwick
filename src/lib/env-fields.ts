// The parsers for one binding, variable or secret each, each failing `missing_binding` by name on a gap. Only
// `env.ts` calls them, as `sso-config.ts` does for its own; no value is ever put in the error.
import { fail } from './errors';
import { isAgeRecipient, isSessionSecret } from './secrets';

export const DEMO_PASSWORD_MIN = 16;

export type Source = Record<string, unknown>;

export function hasMethods(value: unknown, methods: readonly string[]): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return methods.every((m) => typeof record[m] === 'function');
}

export function binding(source: Source, name: string, methods: readonly string[]): unknown {
  const value = source[name];
  if (!hasMethods(value, methods)) fail('missing_binding', name);
  return value;
}

export function text(source: Source, name: string): string {
  const value = source[name];
  if (typeof value !== 'string' || value.trim() === '') fail('missing_binding', name);
  return value;
}

export function origin(source: Source, name: string): string {
  const value = text(source, name);
  if (!URL.canParse(value) || new URL(value).origin !== value) fail('missing_binding', name);
  return value;
}

export function address(source: Source, name: string): string {
  const value = text(source, name);
  if (!/^[^\s@<>]+@[^\s@<>]+$/.test(value)) fail('missing_binding', name);
  return value;
}

export function recipient(source: Source, name: string): string {
  const value = text(source, name);
  if (!isAgeRecipient(value)) fail('missing_binding', name);
  return value;
}

export function secret(source: Source, name: string, valid: (value: string) => boolean): string {
  const value = text(source, name);
  if (!valid(value)) fail('missing_binding', name);
  return value;
}

/** A var that may be unset or empty, which reads as null; set, it must be text. */
export function optionalText(source: Source, name: string): string | null {
  const value = source[name];
  if (value === undefined) return null;
  if (typeof value !== 'string') fail('missing_binding', name);
  return value.trim() === '' ? null : value;
}

/** `SSO_PROVIDERS` as text: a wrangler var written as a JSON array reaches the Worker as an array, so it is stringified. */
export function providersText(source: Source): string | null {
  const value = source.SSO_PROVIDERS;
  return Array.isArray(value) ? JSON.stringify(value) : optionalText(source, 'SSO_PROVIDERS');
}

/** A secret that may be unset or empty, which reads as null; set, it must have the shape `valid` names. */
export function optionalSecret(
  source: Source,
  name: string,
  valid: (value: string) => boolean,
): string | null {
  const value = source[name];
  if (value === undefined || value === '') return null;
  return secret(source, name, valid);
}

/** One of `allowed`, or `unset` when the name is not set at all; any other value fails by name. */
export function choice<T extends string>(
  source: Source,
  name: string,
  allowed: readonly T[],
  unset: T,
): T {
  const value = source[name];
  if (value === undefined) return unset;
  if (!allowed.some((option) => option === value)) fail('missing_binding', name);
  return value as T;
}

/** `MAIL` is `on` (or unset) to send through the `EMAIL` binding, or `off` to send nothing and need neither. */
export function mailOf(source: Source): { EMAIL: SendEmail; MAIL_FROM: string } | null {
  if (choice(source, 'MAIL', ['on', 'off'], 'on') === 'off') return null;
  return {
    EMAIL: binding(source, 'EMAIL', ['send']) as SendEmail,
    MAIL_FROM: address(source, 'MAIL_FROM'),
  };
}

/** The one-time first-admin token when it is a string of at least 43 characters; anything else is null, which turns the claim off. */
export function setupToken(source: Source): string | null {
  const value = source['SETUP_TOKEN'];
  return typeof value === 'string' && isSessionSecret(value) ? value : null;
}

/** The demo password when it is a string of at least 16 characters; anything else is null, never an error. */
export function demoPassword(source: Source): string | null {
  const value = source['DEMO_PASSWORD'];
  return typeof value === 'string' && value.length >= DEMO_PASSWORD_MIN ? value : null;
}
