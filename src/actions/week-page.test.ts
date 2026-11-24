// Runs in the `app` project: the week page's links as the server renders them, at the ends of the date range.
import { describe, expect, it } from 'vitest';
import { caller, getPage } from '../../test/helpers/callers';

const links = (html: string) => [...html.matchAll(/href="(\/week\/[^"]*)"/g)].map((m) => m[1]);

describe('the week page at the ends of the date range', () => {
  it('a week in the last year has no malformed neighbour and a date past it is not found', async () => {
    const who = await caller([]);
    expect((await getPage('/week/9999-12-27', who)).status).toBe(404);
    const last = await getPage('/week/9990-12-31', who);
    expect(last.status).toBe(200);
    const hrefs = links(await last.text());
    expect(hrefs).toContain('/week/9990-12-24');
    expect(hrefs.filter((h) => !/^\/week\/\d{4}-\d{2}-\d{2}$/.test(h ?? ''))).toEqual([]);
    expect(hrefs).not.toContain('/week/9991-01-07');
  });

  it('a week in the middle links to both neighbours', async () => {
    const who = await caller([]);
    const hrefs = links(await (await getPage('/week/2026-01-05', who)).text());
    expect(hrefs).toContain('/week/2025-12-29');
    expect(hrefs).toContain('/week/2026-01-12');
  });
});
