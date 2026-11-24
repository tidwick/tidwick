import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';
import astro from 'eslint-plugin-astro';

export default defineConfig(
  {
    ignores: [
      'dist',
      '.astro',
      '.wrangler',
      'node_modules',
      'worker-configuration.d.ts',
      'src/components/ui',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...astro.configs.recommended,
  {
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
);
