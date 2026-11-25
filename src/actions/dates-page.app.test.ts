// Runs in the `app` project: a person reads dates day first and in words, and a confirmation time without its
// seconds or zone name; ISO stays in addresses and table data.
import { describe, expect, it } from 'vitest';
import { bookedWeek, WEEK } from '../../test/helpers/booking';
import { caller, getPage } from '../../test/helpers/callers';

describe('the pages write dates one way', () => {
  it('the week heading and its column heads are day then month, with no 1/5 style date', async () => {
    const w = await bookedWeek();
    const html = await (await getPage(`/week/${WEEK}`, w.who)).text();
    expect(html).toContain('Week of 5 January 2026');
    expect(html).toContain('Mon 5 Jan');
    expect(html).toContain('Sun 11 Jan');
    expect(html).not.toMatch(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}\/\d{1,2}/);
    expect(html).toContain(`/week/${WEEK}`);
  });

  it('the account page says when a confirmation ends as a time in UTC, with no zone name or seconds', async () => {
    const html = await (await getPage('/account', await caller([], { stepUpAgo: 60_000 }))).text();
    expect(html).toMatch(/Confirmed until \d\d:\d\d UTC\./);
    expect(html).not.toContain('GMT');
    expect(html).not.toMatch(/\d\d:\d\d:\d\d/);
  });
});
