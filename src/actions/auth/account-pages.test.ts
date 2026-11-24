// Runs in the `app` project: the four auth pages as the server renders them, with no script.
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { withPasskey } from '../../../test/helpers/auth';
import { caller, getPage, ORIGIN } from '../../../test/helpers/callers';

const h1s = (html: string) => html.match(/<h1[\s>]/g)?.length ?? 0;

/** Every form control that takes text must be named by a wrapping label or a for/id pair. */
function unlabelled(html: string): string[] {
  const bad: string[] = [];
  for (const m of html.matchAll(/<input\b[^>]*>/g)) {
    const tag = m[0];
    if (/type="(hidden|submit|checkbox)"/.test(tag)) continue;
    const before = html.slice(0, m.index);
    const wrapped = before.lastIndexOf('<label') > before.lastIndexOf('</label>');
    const id = /\bid="([^"]+)"/.exec(tag)?.[1];
    const forId = id !== undefined && html.includes(`for="${id}"`);
    if (!wrapped && !forId && !/aria-label=/.test(tag)) bad.push(tag);
  }
  return bad;
}

describe('the auth pages are labelled and structured', () => {
  it('the login page has one h1, a passkey button, the recovery link and no email field', async () => {
    const html = await (await getPage('/login', null)).text();
    expect(h1s(html)).toBe(1);
    expect(html).toContain('data-passkey="login"');
    expect(html).toContain('href="/recover"');
    expect(html).not.toMatch(/type="email"/);
  });

  it('the recover page has one h1 and every input labelled', async () => {
    const html = await (await getPage('/recover', null)).text();
    expect(h1s(html)).toBe(1);
    expect(unlabelled(html)).toEqual([]);
    expect(html).toContain('name="email"');
  });

  it('the enrol page states the expiry, has one h1 per state, and gates leaving on a confirmation', async () => {
    const html = await (await getPage('/enrol/anything', null)).text();
    expect(html).toMatch(/24\s+hours/);
    expect(h1s(html)).toBe(2);
    expect(html).toContain('data-codes-confirm');
    expect(html).toContain('data-codes-copy');
    expect(html).toContain('data-codes-print');
  });

  it('the account page lists each passkey with a remove form, but not on the only one', async () => {
    const who = await caller();
    const first = await withPasskey(who.personId);
    const alone = await (await getPage('/account', who)).text();
    expect(h1s(alone)).toBe(1);
    expect(alone).toContain('Your only passkey');
    expect(alone).not.toContain('revokePasskey');
    const second = await withPasskey(who.personId);
    const two = await (await getPage('/account', who)).text();
    expect(two).toContain('revokePasskey');
    expect(two).toContain(`value="${first}"`);
    expect(two).toContain(`value="${second}"`);
    expect(two).toMatch(/lose every passkey and every recovery code/);
    expect(two).toContain('Sign out');
  });

  it('beside Remove and new codes the page says neither signs out a browser, and points to Sign out other sessions', async () => {
    const who = await caller();
    await withPasskey(who.personId);
    const alone = await (await getPage('/account', who)).text();
    expect(alone).not.toContain('data-remove-note');
    await withPasskey(who.personId);
    const two = await (await getPage('/account', who)).text();
    expect(two).toContain('data-remove-note');
    expect(two).toMatch(/Removing a passkey does not sign out a browser already signed in with it/);
    expect(two).toMatch(/retires every old one, and does not sign out a browser/);
    expect(two).toContain('auth.logoutOthers');
  });

  it('a recovery session sees the passkeys but no remove button', async () => {
    const who = await caller([], { mustEnrol: true });
    await withPasskey(who.personId);
    await withPasskey(who.personId);
    const html = await (await getPage('/account', who)).text();
    expect(html).not.toContain('revokePasskey');
    expect(html).toContain('Add a passkey');
  });
});

describe('the front door', () => {
  it('a stranger gets the sign-in and recovery links, one h1 and no island', async () => {
    const response = await getPage('/', null);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(h1s(html)).toBe(1);
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/recover"');
    expect(html).not.toContain('<astro-island');
  });

  it('a signed-in person is sent on to the week, and one who still has to enrol to the account page', async () => {
    const sent = (who: Awaited<ReturnType<typeof caller>>) =>
      exports.default.fetch(
        new Request(`${ORIGIN}/`, {
          headers: { cookie: `__Host-tidwick-session=${who.raw}` },
          redirect: 'manual',
        }),
      );
    const member = await caller([]);
    const week = await sent(member);
    expect(week.status).toBe(302);
    expect(week.headers.get('location')).toBe('/week');
    const recovering = await caller([], { mustEnrol: true });
    const account = await sent(recovering);
    expect(account.status).toBe(302);
    expect(account.headers.get('location')).toBe('/account');
  });
});
