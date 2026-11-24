// Runs in the `app` project: every week page names its state in a badge beside the heading, and the approver's page
// says the week is locked once, not three times.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ACCOUNTING, T0 } from '../../test/helpers/auth';
import { bookedWeek, WEEK } from '../../test/helpers/booking';
import { caller, getPage } from '../../test/helpers/callers';
import { submitWeek } from '../db/submissions';

const badges = (html: string): string[] =>
  [...html.matchAll(/<span[^>]*data-week-state="(\w+)"[^>]*>([^<]*)<\/span>/g)].map(
    (m) => `${m[1] ?? ''}:${m[2] ?? ''}`,
  );

describe('a week names its state beside the heading', () => {
  it('a draft week reads Draft and a submitted week reads Submitted, after the heading and before the lead', async () => {
    const w = await bookedWeek();
    const draft = await (await getPage(`/week/${WEEK}`, w.who)).text();
    expect(badges(draft)).toEqual(['draft:Draft']);
    expect(draft.indexOf('<h1')).toBeLessThan(draft.indexOf('data-week-state'));
    await submitWeek(w.member, env.DB, WEEK, T0);
    const locked = await (await getPage(`/week/${WEEK}`, w.who)).text();
    expect(badges(locked)).toEqual(['submitted:Submitted']);
    expect(locked).toContain('This week is submitted and locked.');
  });

  it('the approver sees one badge and never the locked line the badge already says', async () => {
    const w = await bookedWeek();
    await submitWeek(w.member, env.DB, WEEK, T0);
    const html = await (
      await getPage(`/approvals/${w.who.personId}/${WEEK}`, await caller([ACCOUNTING]))
    ).text();
    expect(badges(html)).toEqual(['submitted:Submitted']);
    expect(html).not.toContain('This week is submitted and locked.');
    expect(html).toContain('This week is submitted, waiting for approval');
  });
});
