import { describe, expect, it } from 'vitest';
import { DEMO_RESET_CRON } from '../../src/backup/scheduled';

const files = import.meta.glob<string>(
  ['../../wrangler.jsonc', '../wrangler.test.jsonc', '../../.dev.vars.example'],
  { query: '?raw', import: 'default', eager: true },
);

type Config = Record<string, unknown> & {
  vars?: Record<string, string>;
  env?: Record<string, Config>;
};

function parsed(path: string): Config {
  const raw = files[path] ?? '';
  return JSON.parse(raw.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')) as Config;
}

const main = parsed('../../wrangler.jsonc');
const demo = main.env?.['demo'] ?? {};

describe('the demo deploy config', () => {
  it('is the wrangler environment "demo": Worker tidwick-demo on its own origin, with mail off and the banner on', () => {
    expect(demo['name']).toBe('tidwick-demo');
    expect(demo.vars).toEqual({
      ORIGIN: 'https://demo.tidwick.dev',
      RP_ID: 'demo.tidwick.dev',
      MAIL: 'off',
      DEMO_BANNER: 'on',
      DEMO_LOGIN: 'on',
      BACKUP_COPY: 'none',
    });
    expect(new URL(demo.vars?.['ORIGIN'] ?? '').hostname).toBe(demo.vars?.['RP_ID']);
  });

  it('runs only the nightly reset on a cron, and the secret DEMO_PASSWORD is set on no config', () => {
    expect(demo['triggers']).toEqual({ crons: [DEMO_RESET_CRON] });
    for (const path of Object.keys(files)) expect(files[path]).not.toMatch(/DEMO_PASSWORD/);
  });

  it('has no send-email binding and no account id, and carries its own database id and route', () => {
    expect(demo).not.toHaveProperty('send_email');
    expect(files['../../wrangler.jsonc']).not.toMatch(/account_id/);
    const d1 = demo['d1_databases'] as Record<string, string>[];
    expect(d1).toHaveLength(1);
    expect(d1[0]).toMatchObject({
      binding: 'DB',
      database_name: 'tidwick-db',
      migrations_dir: 'migrations',
    });
    expect(d1[0]?.['database_id']).toBeTruthy();
    const routes = demo['routes'] as Record<string, unknown>[];
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ custom_domain: true });
    expect(routes[0]?.['pattern']).toBeTruthy();
    expect(routes[0]?.['pattern']).toBe('demo.tidwick.dev');
    expect(demo).not.toHaveProperty('r2_buckets');
    expect(main['r2_buckets']).toEqual([{ binding: 'BACKUPS', bucket_name: 'tidwick-backups' }]);
    expect(main['name']).toBe('tidwick');
  });

  it('leaves the banner off and mail on everywhere but the demo', () => {
    for (const config of [main, parsed('../wrangler.test.jsonc')]) {
      expect(config.vars).not.toHaveProperty('DEMO_BANNER');
      expect(config.vars).not.toHaveProperty('DEMO_LOGIN');
      expect(config.vars?.['MAIL'] ?? 'on').toBe('on');
      expect(config['send_email']).toEqual([{ name: 'EMAIL' }]);
    }
    expect(files['../../.dev.vars.example']).toMatch(/^DEMO_BANNER=$/m);
    expect(files['../../.dev.vars.example']).not.toMatch(/DEMO_LOGIN/);
  });
});
