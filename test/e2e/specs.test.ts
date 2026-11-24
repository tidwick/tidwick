import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The Playwright specs run in CI only, so these read their source: the drift a desk check found, kept out.
const read = (path: string): string => readFileSync(path, 'utf8');
const specs = readdirSync('e2e').filter((name) => name.endsWith('.spec.ts'));
const enrolling = specs.filter((name) => read(`e2e/${name}`).includes("from './enrol'"));

describe('the e2e specs follow the live pages', () => {
  it('every spec that enrols does so through e2e/enrol.ts, which ticks the codes box before Continue', () => {
    expect(enrolling.sort()).toEqual([
      'admin.spec.ts',
      'approve.spec.ts',
      'auth.spec.ts',
      'csv.spec.ts',
      'grid.spec.ts',
    ]);
    for (const name of specs) {
      const source = read(`e2e/${name}`);
      expect(source, `${name} adds its own virtual authenticator`).not.toContain('newCDPSession');
      expect(source, `${name} clicks Continue itself`).not.toMatch(/name: 'Continue'/);
    }
    const helper = read('e2e/enrol.ts');
    const tick = helper.indexOf("getByRole('checkbox', { name: /I have saved these codes/ })");
    expect(tick).toBeGreaterThan(-1);
    expect(tick).toBeLessThan(helper.indexOf("getByRole('link', { name: 'Continue' })"));
  });

  it('the checkbox the helper ticks is the one the enrol page labels', () => {
    expect(read('src/pages/enrol/[token].astro')).toMatch(/I have saved these codes\./);
  });

  it('the project page spec matches the assigned address exactly, since the creator is assigned too', () => {
    expect(read('e2e/admin.spec.ts')).toContain(
      "getByText('phone@practice.example', { exact: true })",
    );
  });

  it('a passkey confirmation is proved by the reload it causes, and saved mappings by the Saved status', () => {
    for (const name of ['approve.spec.ts', 'csv.spec.ts']) {
      expect(read(`e2e/${name}`), name).toContain("waitForEvent('load')");
    }
    expect(read('e2e/csv.spec.ts')).toContain("getByText('Saved.', { exact: true })");
  });
});
