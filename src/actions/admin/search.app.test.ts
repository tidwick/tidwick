// Runs in the `app` project: the search box on the people and approvals pages, through the built Worker. It is a
// plain GET parameter, read-only, and the lists keep their roles: a member reads neither with or without a term.
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { ACCOUNTING, ADMIN, T0 } from '../../../test/helpers/auth';
import { bookedWeek, WEEK } from '../../../test/helpers/booking';
import { caller, getPage } from '../../../test/helpers/callers';
import { personById } from '../../db/people';
import { submitWeek } from '../../db/submissions';

const rowsOf = (html: string): number => (html.match(/<tr[ >]/g) ?? []).length;

async function submitted(): Promise<{ name: string; email: string }> {
  const w = await bookedWeek();
  await submitWeek(w.member, env.DB, WEEK, T0);
  const person = await personById(env.DB, w.who.personId);
  return { name: person?.name ?? '', email: person?.email ?? '' };
}

describe('searching the people page', () => {
  it('an admin who searches an email sees that person and the count, and nobody else', async () => {
    const who = await caller([ADMIN]);
    const other = await caller([]);
    const ours = await personById(env.DB, who.personId);
    const theirs = await personById(env.DB, other.personId);
    const page = await getPage(`/admin/people?q=${encodeURIComponent(ours?.email ?? '')}`, who);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('1 person matches');
    expect(html).toContain(`/admin/people/${who.personId}`);
    expect(html).not.toContain(`/admin/people/${other.personId}`);
    expect(html).not.toContain(theirs?.email ?? 'unreachable');
  });

  it('the page offers a GET search form that posts nothing and keeps the typed term, with a way to clear it', async () => {
    const who = await caller([ADMIN]);
    const html = await (await getPage('/admin/people?q=practice', who)).text();
    expect(html).toMatch(/<form[^>]*method="GET"[^>]*action="\/admin\/people"[^>]*role="search"/i);
    expect(html).toMatch(/<input[^>]*name="q"[^>]*value="practice"/);
    expect(html).toContain('Clear search');
    const plain = await (await getPage('/admin/people', who)).text();
    expect(plain).not.toContain('Clear search');
  });

  it('a term nobody holds shows an empty message instead of a blank table', async () => {
    const who = await caller([ADMIN]);
    const html = await (await getPage('/admin/people?q=zzzznobody', who)).text();
    expect(html).toContain('No one matches that search');
    expect(html).toContain('0 people match');
  });

  it('a term is shown as text: markup in it is escaped and wildcards match nothing', async () => {
    const who = await caller([ADMIN]);
    const markup = await (
      await getPage('/admin/people?q=%3Cscript%3Ealert(1)%3C/script%3E', who)
    ).text();
    expect(markup).not.toContain('<script>alert(1)');
    expect(markup).toContain('No one matches');
    const wild = await (await getPage('/admin/people?q=%25', who)).text();
    expect(wild).toContain('No one matches');
  });

  it('a member, an accounting admin without the admin role and a signed-out caller read no list, with or without a term', async () => {
    const visible = await caller([ADMIN]);
    const ours = await personById(env.DB, visible.personId);
    const q = `?q=${encodeURIComponent(ours?.email ?? '')}`;
    for (const [label, who, status] of [
      ['member', await caller([]), 403],
      ['accounting admin', await caller([ACCOUNTING]), 403],
      ['signed out', null, 401],
    ] as const) {
      const page = await getPage(`/admin/people${q}`, who);
      expect(page.status, label).toBe(status);
      expect(await page.text(), label).not.toContain(ours?.email ?? 'unreachable');
    }
  });
});

describe('searching the approvals page', () => {
  it('an accounting admin who searches a name sees that person’s week and no other', async () => {
    const one = await submitted();
    const two = await submitted();
    const who = await caller([ACCOUNTING]);
    const page = await getPage(`/approvals?q=${encodeURIComponent(one.email)}`, who);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(one.name);
    expect(html).not.toContain(two.name);
    expect(html).toMatch(/1 week from 1 person matches/);
    expect(html).toMatch(/<form[^>]*method="GET"[^>]*action="\/approvals"/i);
  });

  it('a search with no match says so and keeps the box, and no search at all lists every submitted week', async () => {
    await submitted();
    await submitted();
    const who = await caller([ACCOUNTING]);
    const none = await (await getPage('/approvals?q=zzzznobody', who)).text();
    expect(none).toContain('No waiting week matches that search');
    expect(none).toContain('name="q"');
    const all = await (await getPage('/approvals', who)).text();
    expect(rowsOf(all)).toBeGreaterThan(rowsOf(none));
    expect(all).not.toContain('No waiting week matches');
  });

  it('a member is refused the page with a term as without one, and sees no name', async () => {
    const one = await submitted();
    const member = await caller([]);
    for (const path of ['/approvals', `/approvals?q=${encodeURIComponent(one.email)}`]) {
      const page = await getPage(path, member);
      expect(page.status, path).toBe(403);
      expect(await page.text(), path).not.toContain(one.name);
    }
  });
});
