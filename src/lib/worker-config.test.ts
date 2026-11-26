// The deployed Worker's own config, read as text: what Cloudflare stores about each request is set there.
import { describe, expect, it } from 'vitest';
import { BACKUP_CRON, CHECK_CRON } from '../backup/scheduled';

const files = import.meta.glob<string>(['../../wrangler.jsonc'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

interface Observability {
  enabled?: boolean;
  logs?: { enabled?: boolean; invocation_logs?: boolean };
}

interface Config {
  observability?: Observability;
  triggers?: { crons?: string[] };
}

/** wrangler.jsonc without its comment lines and the trailing commas JSON refuses. */
function config(text: string): Config {
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')) as Config;
}

const observability = (text: string): Observability | undefined => config(text).observability;

describe('SEC-03 Worker logs', () => {
  it('SEC-03 invocation logs are off, so no request URL, such as an enrolment link, is stored in the Worker logs', () => {
    const text = files['../../wrangler.jsonc'] ?? '';
    expect(text).not.toBe('');
    expect(observability(text)).toMatchObject({ enabled: true, logs: { invocation_logs: false } });
    expect(
      observability(text.replace('"invocation_logs": false', '"invocation_logs": true'))?.logs,
    ).not.toMatchObject({ invocation_logs: false });
  });
});

describe('cron triggers', () => {
  it('the Worker is triggered on exactly the backup and check crons the scheduled handler runs', () => {
    const text = files['../../wrangler.jsonc'] ?? '';
    expect(config(text).triggers?.crons).toEqual([BACKUP_CRON, CHECK_CRON]);
    expect(config(text.replace(`"${BACKUP_CRON}"`, '"0 4 * * *"')).triggers?.crons).not.toEqual([
      BACKUP_CRON,
      CHECK_CRON,
    ]);
  });
});

describe('deployable default', () => {
  const parsed = (text: string): Record<string, unknown> =>
    JSON.parse(text.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')) as Record<
      string,
      unknown
    >;
  const text = files['../../wrangler.jsonc'] ?? '';
  const dbs = (c: Record<string, unknown>): Record<string, unknown>[] =>
    (c['d1_databases'] ?? []) as Record<string, unknown>[];

  it('answers on workers.dev, with no database id of ours at the top level, while the demo stays off workers.dev', () => {
    const main = parsed(text);
    expect(main['workers_dev']).toBe(true);
    expect(dbs(main).every((d) => !('database_id' in d))).toBe(true);
    expect(['account_id', 'route', 'routes'].filter((k) => k in main)).toEqual([]);
    const demo = (main['env'] as Record<string, Record<string, unknown>>)['demo'];
    expect(demo?.['workers_dev']).toBe(false);
    expect(dbs(demo ?? {})[0]?.['database_id']).toBeTruthy();
    expect(
      dbs(
        parsed(
          text.replace(
            '"database_name": "tidwick",',
            '"database_name": "tidwick", "database_id": "x",',
          ),
        ),
      )[0],
    ).toHaveProperty('database_id');
  });
});
