// What a refused POST answers: a page form gets a page with a link back, a script call to `/_actions/` keeps the
// catalog JSON, and the link can lead only into this origin.
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { caller, formPost, ORIGIN, rpcForm } from '../../test/helpers/callers';

/** The refusal page's one link, wherever its attributes put `href`. */
const linkTo = (href: string): RegExp =>
  new RegExp(`<a[^>]*href="${href.replace(/[?.]/g, '\\$&')}"[^>]*>Reload the page</a>`);

describe('what a refused post answers', () => {
  it("SEC-07 a page form with another session's token gets a page naming the reason and linking back, and an Actions call keeps the catalog JSON", async () => {
    const mine = await caller();
    const theirs = await caller();
    const page = await formPost('/account', 'auth.logout', { ...mine, token: theirs.token });
    expect(page.status).toBe(403);
    expect(page.headers.get('content-type')).toMatch(/^text\/html/);
    const html = await page.text();
    expect(html).toMatch(linkTo('/account'));
    expect(html).not.toContain('"error"');
    const refused = await rpcForm('auth.logout', { ...mine, token: theirs.token });
    expect(refused.status).toBe(403);
    expect(refused.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await refused.json()).toMatchObject({ error: 'csrf' });
  });

  it('SEC-07 the page a refused form gets links only to this origin, whatever Referer it sent, and never says Saved', async () => {
    const who = await caller();
    const post = (referer: string) =>
      exports.default.fetch(
        new Request(`${ORIGIN}/account?_action=auth.logout`, {
          method: 'POST',
          headers: {
            origin: ORIGIN,
            cookie: `__Host-tidwick-session=${who.raw}`,
            'content-type': 'application/x-www-form-urlencoded',
            referer,
          },
          body: '_csrf=x',
        }),
      );
    expect(await (await post(`${ORIGIN}/clients?x=1`)).text()).toContain('href="/clients?x=1"');
    expect(await (await post(`${ORIGIN}/clients?a=1&b=<2>`)).text()).toContain(
      'href="/clients?a=1&amp;b=%3C2%3E"',
    );
    const saved = await (await post(`${ORIGIN}/clients?saved=1`)).text();
    expect(saved).toMatch(linkTo('/clients'));
    expect(saved).not.toContain('saved=1');
    const editing = await (await post(`${ORIGIN}/approvals/x/2026-11-16?edit=1&saved=1`)).text();
    expect(editing).toMatch(linkTo('/approvals/x/2026-11-16?edit=1'));
    const foreign = await (await post('https://evil.example/phish')).text();
    expect(foreign).toContain('href="/account"');
    expect(foreign).not.toContain('evil.example');
  });
});
