import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';
import { builtinRules } from 'eslint/use-at-your-own-risk';
import astro from 'eslint-plugin-astro';

// The boundaries of docs/ARCHITECTURE.md §8 on the AST. Each is no-restricted-syntax under its own name: flat config
// replaces a rule's options per file, and one file can sit under several boundaries.
const syntax = builtinRules.get('no-restricted-syntax');
const NAMES = [
  'sql-boundary',
  'role-boundary',
  'import-gate',
  'test-support-gate',
  'cron-scope-gate',
  'test-boundary',
];
const guard = { rules: Object.fromEntries(NAMES.map((name) => [name, syntax])) };
const source = (re, not = '') =>
  `:matches(ImportDeclaration, ExportAllDeclaration, ExportNamedDeclaration, ImportExpression, TSImportType)[source.value=${re}]${not}`;
const SQL = 'SQL lives under src/db/: move the statement into a src/db/ module beside its row type';
const prepare = { selector: "MemberExpression[property.name='prepare']", message: SQL };
const exec = {
  selector:
    "CallExpression[callee.property.name='exec'][arguments.0.type=/^(Literal|TemplateLiteral)$/]",
  message: SQL,
};
const ROLE =
  'A role name outside src/routes.ts and src/db/: add a row to src/routes.ts or use GRANTS from src/db/roles.ts';
const SHIPS =
  'Production source reaches test support or systemScope: keep it in a *.test.ts file or src/db/test-support*.ts';
const CRON =
  "cronScope is the demo wipe's all-clients scope: only src/db/demo-wipe.ts may use it, so take the narrowest Scope your path has";
const EDGE =
  '/^(astro|cloudflare):|[/](actions|middleware|pages|components|layouts|worker)([/]|$)/';
const edge = (not = '') => [
  'error',
  {
    selector: source(EDGE, not),
    message:
      'The data and library layers import the edge: move that code into src/middleware/ or src/actions/',
  },
];

export default defineConfig(
  {
    ignores: ['dist', '.astro', '.wrangler', 'node_modules', 'worker-configuration.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...astro.configs.recommended,
  {
    linterOptions: { noInlineConfig: true },
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  { files: ['**/*.mjs', '**/*.js'], extends: [tseslint.configs.disableTypeChecked] },
  // The browser globals this file declares in its own header comment.
  { files: ['src/theme/theme.js'], linterOptions: { noInlineConfig: false } },
  {
    files: ['scripts/bootstrap.ts', 'src/db/bootstrap.ts', 'src/db/sql-text.ts'],
    rules: { 'no-control-regex': 'off' },
  },
  { plugins: { guard } },
  {
    files: ['{src,test,scripts,e2e}/**'],
    ignores: ['src/db/**'],
    rules: { 'guard/sql-boundary': ['error', prepare] },
  },
  {
    files: ['{src,scripts,e2e}/**'],
    ignores: ['src/db/**', '**/*.test.*'],
    rules: { 'guard/sql-boundary': ['error', prepare, exec] },
  },
  {
    files: ['src/**'],
    ignores: ['src/routes.ts', 'src/db/**'],
    rules: {
      'guard/role-boundary': [
        'error',
        { selector: 'Literal[raw=/[\'"`](accounting_admin|admin)[\'"`]/]', message: ROLE },
        {
          selector: 'TemplateElement[value.raw=/(^|[\'"])(accounting_admin|admin)([\'"]|$)/]',
          message: ROLE,
        },
      ],
    },
  },
  {
    files: ['src/**'],
    ignores: ['**/*.test.*', 'src/db/scope.ts', 'src/db/test-support*.ts'],
    rules: {
      'guard/test-support-gate': [
        'error',
        { selector: 'Identifier[name=/systemScope/]', message: SHIPS },
        { selector: 'Literal[value=/test-support|systemScope/]', message: SHIPS },
        { selector: 'TemplateElement[value.raw=/test-support|systemScope/]', message: SHIPS },
      ],
    },
  },
  {
    // cronScope() equals systemScope(), so it is pinned to the one scheduled path that needs every client.
    files: ['src/**'],
    ignores: ['src/db/scope.ts', 'src/db/demo-wipe.ts'],
    rules: {
      'guard/cron-scope-gate': ['error', { selector: 'Identifier[name=cronScope]', message: CRON }],
    },
  },
  {
    // src/db/demo-wipe.ts reseeds the demo from test/demo/.
    files: ['src/**'],
    ignores: ['**/*.test.*', 'src/db/test-support*.ts', 'src/db/demo-wipe.ts'],
    rules: {
      'guard/test-boundary': [
        'error',
        {
          selector: source('/(^|[/])test[/]/'),
          message: 'Shipped source imports test/: move what it needs under src/',
        },
      ],
    },
  },
  {
    files: ['src/{db,auth,backup,lib}/**'],
    ignores: ['**/*.test.ts'],
    rules: { 'guard/import-gate': edge() },
  },
  // The two imports that bind the Workers runtime on purpose: the environment reader and the mail sender.
  {
    files: ['src/lib/env.ts'],
    rules: { 'guard/import-gate': edge(":not([source.value='cloudflare:workers'])") },
  },
  {
    files: ['src/lib/mail.ts'],
    rules: { 'guard/import-gate': edge(":not([source.value='cloudflare:email'])") },
  },
);
