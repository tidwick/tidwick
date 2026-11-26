// Runs in the `app` project: a normal session reads its account inside the signed-in frame, with the navigation
// and Account marked current; a recovery session can reach nothing else and keeps the bare card with no navigation.
import { describe, expect, it } from 'vitest';
import { caller, getPage } from '../../../test/helpers/callers';

describe('the account page keeps a normal session in the app and a recovery session in its card', () => {
  it('a normal session sees the navigation with Account current, one h1, and every card button the same width rule', async () => {
    const html = await (await getPage('/account', await caller())).text();
    expect(html).toContain('<nav aria-label="Main"');
    expect(html).toMatch(
      /<a[^>]*href="\/account"[^>]*aria-current="page"|<a[^>]*aria-current="page"[^>]*href="\/account"/,
    );
    // One shown, and one in the hidden recovery-codes step.
    expect([...html.matchAll(/<h1[ >]/g)]).toHaveLength(2);
    expect(html).not.toContain('Back to your week');
    expect(html).not.toMatch(/<button[^>]*class="[^"]*\bw-full\b/);
  });

  it('a recovery session sees no navigation and the notice to add a passkey', async () => {
    const html = await (await getPage('/account', await caller([], { mustEnrol: true }))).text();
    expect(html).not.toContain('<nav aria-label="Main"');
    expect(html).toContain('You signed in with a recovery code');
    // One shown, and one in the hidden recovery-codes step.
    expect([...html.matchAll(/<h1[ >]/g)]).toHaveLength(2);
    expect(html).toContain('Sign out');
    expect(html).not.toContain('Make new recovery codes');
  });
});
