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
                // The agent routes are on here; the demo project leaves them off, as a deployment does by default.
                MCP: 'on',
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
                DEMO_PASSWORD: 'a-long-demo-<&"pass',
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
