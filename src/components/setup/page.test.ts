import { describe, expect, it } from 'vitest';

const page =
  Object.values(
    import.meta.glob<string>('../../pages/setup.astro', {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
  )[0] ?? '';

// The built app pool is always configured, so the unconfigured page is never rendered in CI; its markup is pinned here.
describe('the setup page source', () => {
  it('SEC-47 has a form only inside the claim branch, and no generator input has a name', () => {
    const [before, after] = page.split('{claim && (');
    expect(before).not.toContain('<form');
    expect(after?.match(/<form/g)).toHaveLength(1);
    const generator = after?.slice(after.indexOf('</form>')) ?? '';
    expect(generator).not.toContain('<form');
    expect(generator).not.toMatch(/<Input[^>]*\sname=/);
  });

  it('offers one kit download, a live region for Generate, and generates SETUP_TOKEN, with no inline style', () => {
    expect(page.match(/data-kit-download/g)).toHaveLength(2);
    expect(page).toContain('role="status"');
    expect(page).toContain("'SETUP_TOKEN'");
    expect(page).not.toMatch(/\sstyle=/);
  });
});
