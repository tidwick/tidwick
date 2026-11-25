// Runs instead of session, CSRF and authz on `/setup` alone while the env does not parse: it renders only while a
// binding is missing and the database is empty; with any history, or no readable database, it throws what
// `readEnv` would have, so the page and log line are the old ones. It reports names, never a configured value.
// Once the env parses, `/setup` is a 404 unless the database is empty; then the page is the first-admin claim and
// runs the full chain (session, CSRF, authz) like every other form.
import type { MiddlewareHandler } from 'astro';
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
  readonly tokenSet: boolean;
}

export function setup(configured: MiddlewareHandler, source?: object): MiddlewareHandler {
  return async (context, next) => {
    const env = setupEnv(source);
    if (env === null) {
      const ready = source === undefined ? currentEnv() : readEnv(source);
      if (!(await instanceEmpty(ready.DB))) fail('not_found');
      const { origin, hostname } = context.url;
      const tokenSet = ready.SETUP_TOKEN !== null;
      const wrong = ready.ORIGIN !== origin;
      context.locals.setup = {
        missing: [],
        flags: wrong
          ? [`ORIGIN is not this address: set ORIGIN=${origin} and RP_ID=${hostname}`]
          : [],
        claim: tokenSet && !wrong,
        tokenSet,
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
    context.locals.setup = { missing: env.missing, flags, claim: false, tokenSet: false };
    return next();
  };
}
