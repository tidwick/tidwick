// Runs in the `app` project: every refusal a browser meets is the app's own page, a signed-out request to a page
// goes to sign-in and comes back, and every page shows one navigation for one set of grants.
import { describe, expect, it } from 'vitest';
import { caller, getPage, type Caller } from '../../test/helpers/callers';
import { ACCOUNTING, ADMIN } from '../../test/helpers/auth';
import { builtRoutes, samplePath } from '../../test/helpers/route-manifest';
import type { Grant } from '../db/roles';
import { PAGES } from '../routes';
import { signInRedirect } from './authz';

const navOf = (html: string): string[] => {
  const nav = /<nav aria-label="Main"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
  return [...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1] ?? '');
};

describe('a signed-out request to a page goes to sign-in and returns', () => {
  it('answers 303 to /login with the path and query to come back to', async () => {
    const plain = await getPage('/clients', null);
    expect(plain.status).toBe(303);
    expect(plain.headers.get('location')).toBe('/login?return=%2Fclients');
    const queried = await getPage('/audit?who=a%20b', null);
    expect(queried.headers.get('location')).toBe('/login?return=%2Faudit%3Fwho%3Da%2520b');
  });

  it('SEC-49 a return that is not a path of this site is dropped, never followed', () => {
    for (const bad of [
      'http://localhost//evil.example/x',
      'http://localhost/\\evil.example',
      'http://localhost/auth/sso/enrol?token=t',
    ]) {
      const location = signInRedirect(new URL(bad)).headers.get('location');
      expect(location, bad).toBe('/login');
    }
    expect(signInRedirect(new URL('http://localhost/week')).headers.get('location')).toBe(
      '/login?return=%2Fweek',
    );
  });

  it('SEC-49 the sign-in page carries only a safe return to the passkey button', async () => {
    const page = async (path: string) => (await getPage(path, null)).text();
    expect(await page('/login?return=/clients')).toContain('data-return="/clients"');
    for (const bad of ['//evil.example', 'https://evil.example/x', '/\\evil.example'])
      expect(await page(`/login?return=${encodeURIComponent(bad)}`), bad).toContain(
        'data-return="/week"',
      );
  });
});

describe('a refusal is the app page with the person’s own way home', () => {
  it('a missing record is a styled 404 in the signed-in frame', async () => {
    const who = await caller([]);
    const response = await getPage('/clients/no-such-client', who);
    const html = await response.text();
    expect(response.status).toBe(404);
    expect(html).toContain('<h1');
    expect(html).toContain('Not found');
    expect(html).toContain('rel="stylesheet"');
    expect(navOf(html)).toContain('/week');
    expect(html).toContain('href="/week">Go to your week');
  });

  it('a week address that is no week is the same page, not plain text', async () => {
    const response = await getPage('/week/not-a-date', await caller([]));
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('rel="stylesheet"');
  });

  it('a wrong role gets a styled 403 whose link goes to the first page its roles open', async () => {
    const who = await caller([ACCOUNTING]);
    const response = await getPage('/admin/people', who);
    const html = await response.text();
    expect(response.status).toBe(403);
    expect(html).toContain('rel="stylesheet"');
    expect(html).toContain('href="/approvals">Go to approvals');
  });

  it('a stale step-up links to the account, where it is confirmed', async () => {
    const who = await caller([ACCOUNTING], { stepUpAgo: 60 * 60 * 1000 });
    const response = await getPage('/approvals/x/2026-01-05', who);
    expect(response.status).toBe(403);
    expect(await response.text()).toMatch(/<a[^>]*href="\/account"[^>]*>Confirm on your account/);
  });

  it('an address of the error page itself is a 404, and signed out its link is sign-in', async () => {
    const response = await getPage('/error', null);
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('href="/login">Sign in');
  });
});

describe('every page shows the same navigation for the same grants', () => {
  const GRANT_SETS: readonly (readonly Grant[])[] = [
    [],
    [ACCOUNTING],
    [ADMIN],
    [ACCOUNTING, ADMIN],
  ];

  it('SEC-50 each page a role can open, and the refusal page, list one set of links', async () => {
    const routes = builtRoutes()
      .filter((r) => r.origin === 'project')
      .map((r) => r.route)
      .filter((route) => {
        const rule = PAGES[route]?.GET;
        return rule !== undefined && !rule.roles.includes('public');
      });
    for (const grants of GRANT_SETS) {
      const who: Caller = await caller(grants);
      const expected = navOf(await (await getPage('/error', who)).text());
      expect(expected, grants.join()).toContain('/week');
      expect(expected.includes('/approvals'), grants.join()).toBe(grants.includes(ACCOUNTING));
      expect(expected.includes('/admin/people'), grants.join()).toBe(grants.includes(ADMIN));
      for (const route of routes) {
        const response = await getPage(samplePath(route), who);
        const html = await response.text();
        if (response.status >= 300 && response.status < 400) continue;
        if (!html.includes('<nav aria-label="Main"')) continue;
        expect(navOf(html), `${route} as ${grants.join() || 'member'}`).toEqual(expected);
      }
    }
  });
});
