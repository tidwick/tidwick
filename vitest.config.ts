import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { generateX25519Identity, identityToRecipient } from 'age-encryption';
import { defineConfig } from 'vitest/config';

// A test's project is its file suffix: *.app.test.ts runs in the built Worker, *.demo.test.ts in the built Worker with
// the demo's three vars set (each file seeds the marker itself, so the gate opens only there), *.dom.test.ts[x] in
// jsdom for a browser's DOM (focus, keys, disclosure; ADR 0012). Any other *.test.ts is a unit test in workerd.
const APP = 'src/**/*.app.test.ts';
const DEMO = 'src/**/*.demo.test.ts';
const DOM = ['src/**/*.dom.test.{ts,tsx}', 'test/**/*.dom.test.ts'];

// Fresh dummies per run: no test reads a real secret, and none can depend on a fixed value. The backup
// identity is a test-only binding so the backup tests can decrypt what the scheduled handler wrote.
const backupIdentity = await generateX25519Identity();
// Three tenants of one provider (the third is only ever down or misconfigured, so no test caches its metadata) and
// Google (restricted to one Workspace domain), so a test can cross them; their secrets are fresh dummies too. The demo project sets none, which is how SSO is off by default.
const ssoProviders = JSON.stringify([
  {
    id: 'tenant-a',
    label: 'Tenant A',
    issuer: 'https://idp-a.example/a/v2.0',
    client_id: 'client-a',
  },
  {
    id: 'tenant-b',
    label: 'Tenant B',
    issuer: 'https://idp-b.example/b/v2.0',
    client_id: 'client-b',
  },
  {
    id: 'tenant-c',
    label: 'Tenant C',
    issuer: 'https://idp-c.example/c/v2.0',
    client_id: 'client-c',
  },
  { id: 'google', client_id: 'client-g', hd: 'practice.example' },
]);
const ssoSecrets = () => ({
  SSO_SECRET_TENANT_A: randomBytes(24).toString('base64url'),
  SSO_SECRET_TENANT_B: randomBytes(24).toString('base64url'),
  SSO_SECRET_TENANT_C: randomBytes(24).toString('base64url'),
  SSO_SECRET_GOOGLE: randomBytes(24).toString('base64url'),
});

const secrets = async () => ({
  SESSION_SECRET: randomBytes(32).toString('base64url'),
  NOTE_KEK: randomBytes(32).toString('base64'),
  BACKUP_RECIPIENT: await identityToRecipient(backupIdentity),
  TEST_BACKUP_IDENTITY: backupIdentity,
});

// Outside a build, `astro:actions` resolves to the module that defines ActionError, which the catalog uses.
const astroActions = fileURLToPath(
  new URL('./node_modules/astro/dist/actions/runtime/client.js', import.meta.url),
);

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: './test/wrangler.test.jsonc' },
            miniflare: {
              bindings: {
                ...(await secrets()),
                TEST_MIGRATIONS: await readD1Migrations('./migrations'),
              },
            },
          })),
        ],
        resolve: { alias: { 'astro:actions': astroActions } },
        test: {
          name: 'unit',
          include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.ts'],
          exclude: [APP, DEMO, ...DOM],
          setupFiles: ['./test/apply-migrations.ts'],
        },
      },
      {
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: './dist/server/wrangler.json' },
            miniflare: {
              bindings: {
                ...(await secrets()),
                // The built Worker runs mid-rotation, so every app test reads keys under either KEK (ADR 0005).
                NOTE_KEK_PREVIOUS: randomBytes(32).toString('base64'),
                // The first-admin claim is open here (src/actions/setup/claim.app.test.ts); the demo project sets none.
                SETUP_TOKEN: randomBytes(32).toString('base64url'),
                // The agent routes are on here; the demo project leaves them off, as a deployment does by default.
                MCP: 'on',
                // The built config's ORIGIN is the http localhost default; MCP=on refuses that without this (src/lib/env.test.ts).
                LOCAL_DEV: 'on',
                MCP_NOTES: '',
                // Policy knobs set off their defaults, so an app test proves a deploy variable reaches the Action or page that
                // reads it (src/lib/policy.test.ts holds every knob's parsing and bounds); the unit and demo projects keep the defaults.
                AGENT_TOKEN_MAX: '4',
                AGENT_TOKEN_DAYS: '7,30,180',
                AGENT_TOKEN_DEFAULT_DAYS: '180',
                MCP_ACCESS_MINUTES: '45',
                MCP_REFRESH_DAYS: '20',
                MCP_GRANT_DAYS: '60',
                AUDIT_PAGE_ROWS: '20',
                ENROLMENT_HOURS: '48',
                PENDING_CODES_MINUTES: '5',
                NOT_SUBMITTED_WEEKS: '3',
                BACKUP_KEEP_DAYS: '30',
                SSO_PROVIDERS: ssoProviders,
                ...ssoSecrets(),
                TEST_MIGRATIONS: await readD1Migrations('./migrations'),
              },
            },
          })),
        ],
        resolve: { alias: { 'astro:actions': astroActions } },
        test: { name: 'app', include: [APP], setupFiles: ['./test/apply-migrations.ts'] },
      },
      {
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: './dist/server/wrangler.json' },
            miniflare: {
              bindings: {
                ...(await secrets()),
                DEMO_LOGIN: 'on',
                DEMO_BANNER: 'on',
                // Off, whatever a local .dev.vars says: the demo project proves the default (src/mcp/off.demo.test.ts).
                MCP: '',
                TEST_MIGRATIONS: await readD1Migrations('./migrations'),
              },
            },
          })),
        ],
        resolve: { alias: { 'astro:actions': astroActions } },
        test: { name: 'demo', include: [DEMO], setupFiles: ['./test/apply-migrations.ts'] },
      },
      {
        resolve: { alias: { 'astro:actions': astroActions } },
        test: {
          name: 'dom',
          include: DOM,
          environment: 'jsdom',
          setupFiles: ['./test/dom-setup.ts'],
        },
      },
    ],
  },
});
