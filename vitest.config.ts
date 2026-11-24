import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { generateX25519Identity, identityToRecipient } from 'age-encryption';
import { defineConfig } from 'vitest/config';

const APP_TESTS = [
  'src/headers.test.ts',
  'src/middleware/csrf.test.ts',
  'src/middleware/csrf-refusal.test.ts',
  'src/middleware/errors.test.ts',
  'src/middleware/authz.test.ts',
  'src/auth/step-up.test.ts',
  'src/actions/admin/page-details.test.ts',
  'src/actions/admin/people-list.test.ts',
  'src/actions/admin/permissions.test.ts',
  'src/actions/approvals-list.test.ts',
  'src/actions/admin/actions.test.ts',
  'src/actions/admin/settings.test.ts',
  'src/actions/admin/rewrap.test.ts',
  'src/actions/admin/audit.test.ts',
  'src/actions/admin/search.test.ts',
  'src/actions/dates-page.test.ts',
  'src/actions/entries*.test.ts',
  'src/actions/export.test.ts',
  'src/actions/import.test.ts',
  'src/actions/submission*.test.ts',
  'src/actions/week-page.test.ts',
  'src/actions/week-state.test.ts',
  'src/actions/saved-line.test.ts',
  'src/actions/step-up-line.test.ts',
  'src/actions/auth/*.test.ts',
];

// The built Worker with the demo's three vars set; each test file seeds the marker itself, so the gate opens only there.
const DEMO_TESTS = ['src/actions/demo-gate.test.ts', 'src/actions/demo-page.test.ts'];

// Tests that need a browser's DOM (focus, keys, disclosure) run in jsdom, not in workerd (ADR 0012).
const DOM_TESTS = [
  'src/theme/theme.test.ts',
  'src/components/passkey/codes.test.ts',
  'test/e2e/specs.test.ts',
  'src/components/week-grid/decide.test.tsx',
  'src/components/week-grid/keyboard.test.tsx',
  'src/components/week-grid/layout.test.tsx',
  'src/components/week-grid/messages.test.tsx',
  'src/components/week-grid/ledger.test.tsx',
  'src/components/week-grid/phone.test.tsx',
  'src/components/week-grid/totals.test.tsx',
  'src/components/week-grid/unsaved.test.tsx',
  'src/components/week-grid/api.test.tsx',
  'src/components/week-grid/add-row.test.tsx',
];

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
          exclude: [...APP_TESTS, ...DEMO_TESTS, ...DOM_TESTS],
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
                TEST_MIGRATIONS: await readD1Migrations('./migrations'),
              },
            },
          })),
        ],
        resolve: { alias: { 'astro:actions': astroActions } },
        test: { name: 'app', include: APP_TESTS, setupFiles: ['./test/apply-migrations.ts'] },
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
        test: { name: 'demo', include: DEMO_TESTS, setupFiles: ['./test/apply-migrations.ts'] },
      },
      {
        resolve: { alias: { 'astro:actions': astroActions } },
        test: {
          name: 'dom',
          include: DOM_TESTS,
          environment: 'jsdom',
          setupFiles: ['./test/dom-setup.ts'],
        },
      },
    ],
  },
});
