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

/** wrangler.jsonc without the trailing commas JSON refuses; it carries no comments. */
function config(text: string): Config {
  return JSON.parse(text.replace(/,(\s*[}\]])/g, '$1')) as Config;
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
