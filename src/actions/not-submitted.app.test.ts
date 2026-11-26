// Runs in the `app` project: the Not submitted section of /approvals lists the people on the books with a recent week
// handed in by no one, each week a link to its page.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ACCOUNTING, offboard, T0 } from '../../test/helpers/auth';
import { bookedWeek } from '../../test/helpers/booking';
import { caller, getPage, type Caller } from '../../test/helpers/callers';
import { scopeFor } from '../db/scope';
import { submitWeek } from '../db/submissions';

const text = async (path: string, who: Caller): Promise<string> =>
  (await getPage(path, who)).text();
const approver = async (): Promise<{ who: Caller }> => ({ who: await caller([ACCOUNTING]) });

describe('the Not submitted section', () => {
  it('lists a person on the books with no week handed in, each week a link to their week page, and leaves out the offboarded', async () => {
    const { who } = await approver();
    const here = await bookedWeek();
    const gone = await bookedWeek();
    await offboard(gone.who.personId);
    const html = await text('/approvals', who);
    expect(html).toContain('Not submitted');
    const links = [
      ...html.matchAll(new RegExp(`/approvals/${here.who.personId}/(\\d{4}-\\d{2}-\\d{2})`, 'g')),
    ];
    expect(links).toHaveLength(4);
    expect(html).not.toContain(`/approvals/${gone.who.personId}/`);
  });

  it('a week the person has since submitted drops out of it', async () => {
    const { who } = await approver();
    const w = await bookedWeek();
    const before = await text('/approvals', who);
    const [first] = [
      ...before.matchAll(new RegExp(`/approvals/${w.who.personId}/(\\d{4}-\\d{2}-\\d{2})`, 'g')),
    ];
    const week = first?.[1] ?? '';
    expect(week).not.toBe('');
    const member = await scopeFor(env.DB, w.who.personId);
    await submitWeek(member, env.DB, week, T0);
    const section = (await text('/approvals', who)).split('id="missing-h"')[1] ?? '';
    expect(section).toContain(`/approvals/${w.who.personId}/`);
    expect(section).not.toContain(`/approvals/${w.who.personId}/${week}"`);
  });
});
