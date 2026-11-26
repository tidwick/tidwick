// Runs instead of session, CSRF and authz on `/setup` alone while the env does not parse: it renders only while a
// binding is missing and the database is empty; with any history, or no readable database, it throws what
// `readEnv` would have, so the page and log line are the old ones. It reports names, never a configured value.
// Once the env parses, `/setup` is a 404 unless the database is empty or its one admin cannot yet sign in; then the
// page is the first-admin claim (or, without SETUP_TOKEN, the line that names it) and runs the full chain (session,
// CSRF, authz) like every other form.
import type { MiddlewareHandler } from 'astro';
import { claimOpen, rpIdFits } from '../auth/setup-claim';
import { instanceEmpty } from '../db/empty';
import { s3Target } from '../backup/s3-copy';
import { fail } from '../lib/errors';
import { currentEnv, readEnv, setupEnv } from '../lib/env';
import { pageRule } from '../routes';

/** What the page shows: the binding names `readEnv` refuses, and lines about settings that look unfinished. */
export interface SetupReport {
  readonly missing: readonly string[];
  readonly flags: readonly string[];
  /** The claim form is open: the env parses, the database is empty, SETUP_TOKEN is set and ORIGIN is this address. */
  readonly claim: boolean;
}

export function setup(configured: MiddlewareHandler, source?: object): MiddlewareHandler {
  return async (context, next) => {
    const env = setupEnv(source);
    if (env === null) {
      const ready = source === undefined ? currentEnv() : readEnv(source);
      if (!(await claimOpen(ready.DB))) fail('not_found');
      const { origin, hostname } = context.url;
      const flags: string[] = [];
      if (ready.ORIGIN !== origin)
        flags.push(`ORIGIN is not this address: set ORIGIN=${origin} and RP_ID=${hostname}`);
      else if (!rpIdFits(ready.ORIGIN, ready.RP_ID))
        flags.push(
          `RP_ID is not this host or a parent of it: set RP_ID=${hostname}; a passkey made under the wrong one never works`,
        );
      context.locals.setup = {
        missing: ready.SETUP_TOKEN === null ? ['SETUP_TOKEN'] : [],
        flags,
        claim: flags.length === 0 && ready.SETUP_TOKEN !== null,
      };
      const response = await configured(context, next);
      if (response === undefined) fail('internal');
      return response;
    }
    if (pageRule('/setup', context.request.method) === undefined) fail('forbidden');
    const name = env.missing[0];
    const empty = env.DB !== null && (await instanceEmpty(env.DB).catch(() => false));
    if (!empty) fail('missing_binding', name);
    const { origin, hostname } = context.url;
    const flags: string[] = [];
    if (env.ORIGIN !== origin)
      flags.push(`ORIGIN is not this address: set ORIGIN=${origin} and RP_ID=${hostname}`);
    if (env.MAIL_FROM?.endsWith('@example.com'))
      flags.push('MAIL_FROM is still the example sender: set your own, or MAIL=off');
    if (env.copy.BACKUP_COPY === 's3' && typeof s3Target(env.copy) === 'string')
      flags.push('off-account copy not set (BACKUP_S3_*)');
    context.locals.session = null;
    context.locals.csrf = '';
    context.locals.cookies = [];
    context.locals.scope = null;
    context.locals.grants = [];
    const missing = env.SETUP_TOKEN === null ? [...env.missing, 'SETUP_TOKEN'] : env.missing;
    context.locals.setup = { missing, flags, claim: false };
    return next();
  };
}
