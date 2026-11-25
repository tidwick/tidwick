// Runs instead of session, CSRF and authz on `/setup` alone. It answers 404 once the env parses, and renders only
// while a binding is missing and the database is empty; with any history, or no readable database, it throws what
// `readEnv` would have, so the page and log line are the old ones. It reports names, never a configured value.
import type { MiddlewareHandler } from 'astro';
import { instanceEmpty } from '../db/empty';
import { s3Target } from '../backup/s3-copy';
import { fail } from '../lib/errors';
import { setupEnv } from '../lib/env';
import { pageRule } from '../routes';

/** What the page shows: the binding names `readEnv` refuses, and lines about settings that look unfinished. */
export interface SetupReport {
  readonly missing: readonly string[];
  readonly flags: readonly string[];
}

export function setup(source?: object): MiddlewareHandler {
  return async (context, next) => {
    if (pageRule('/setup', context.request.method) === undefined) fail('forbidden');
    const env = setupEnv(source);
    if (env === null) fail('not_found');
    const first = env.missing[0];
    const empty = env.DB !== null && (await instanceEmpty(env.DB).catch(() => false));
    if (!empty) fail('missing_binding', first);
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
    context.locals.setup = { missing: env.missing, flags };
    return next();
  };
}
