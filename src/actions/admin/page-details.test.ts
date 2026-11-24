// Runs in the `app` project: small details of the admin pages a person notices, each a sentence in the test title.
import { describe, expect, it } from 'vitest';
import { ACCOUNTING, ADMIN } from '../../../test/helpers/auth';
import { booking } from '../../../test/helpers/booking';
import { caller, getPage } from '../../../test/helpers/callers';

describe('admin page details', () => {
  it('a project page marks Clients as the current section, and only that link', async () => {
    const b = await booking();
    const html = await (await getPage(`/projects/${b.projectId}`, b.who)).text();
    const current = [...html.matchAll(/<a[^>]*aria-current="page"[^>]*>\s*([^<]*?)\s*<\/a>/g)].map(
      (m) => m[1],
    );
    expect(current).toEqual(['Clients']);
  });

  it('the allowed-tasks save is a primary button like every other save on the admin pages', async () => {
    const b = await booking();
    const admin = await caller([ADMIN]);
    const html = await (await getPage(`/projects/${b.projectId}`, admin)).text();
    const button = html.match(/<button[^>]*class="([^"]*)"[^>]*>\s*Save allowed tasks/);
    expect(button?.[1]).toContain('bg-primary');
    expect(button?.[1]).not.toContain('border-control');
  });

  it('the note keys text keeps a space before the secret name', async () => {
    const html = await (await getPage('/admin/settings', await caller([ADMIN]))).text();
    expect(html).toMatch(/under the\s+<code>NOTE_KEK<\/code> secret/);
    expect(html).not.toMatch(/under the<code>/);
  });

  it('the audit filter rows keep every control to one height and one top edge', async () => {
    const html = await (await getPage('/audit', await caller([ADMIN]))).text();
    const filter =
      html.match(/<form[^>]*aria-labelledby="audit-filter-h"[\s\S]*?<\/form>/)?.[0] ?? '';
    const roots = filter.match(/<div class="grid content-start gap-1\.5">/g) ?? [];
    // Six labelled controls, each a root that holds its rows at the top instead of stretching them.
    expect(roots).toHaveLength(6);
    expect(filter).toMatch(/\[&(amp;)?_select\]:h-11/);
    expect(filter).toMatch(/md:\[&(amp;)?_select\]:h-9/);
  });

  it('export and reports open on a filled range that is one whole calendar month', async () => {
    const who = await caller([ACCOUNTING]);
    for (const path of ['/export', '/reports']) {
      const html = await (await getPage(path, who)).text();
      const from = html.match(/<input[^>]*name="from"[^>]*value="([^"]+)"/)?.[1] ?? '';
      const to = html.match(/<input[^>]*name="to"[^>]*value="([^"]+)"/)?.[1] ?? '';
      expect(from, path).toMatch(/^\d{4}-\d\d-01$/);
      // The day after `to` is the first of the month after `from`.
      const next = new Date(`${to}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      const start = new Date(`${from}T00:00:00Z`);
      start.setUTCMonth(start.getUTCMonth() + 1);
      expect(next.toISOString().slice(0, 10), path).toBe(start.toISOString().slice(0, 10));
    }
  });
});
