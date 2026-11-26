// Runs in the `app` project: a no-script form that succeeds redirects with `?saved=1`, and the page it lands on is
// rendered by the built Worker, so these read the Saved line the browser gets, not only the Location header.
import { describe, expect, it } from 'vitest';
import { ACCOUNTING, withPasskey } from '../../test/helpers/auth';
import { addRow, booking, cell, save, WEEK } from '../../test/helpers/booking';
import { caller, formPost, getPage, rpcForm, type Caller } from '../../test/helpers/callers';

const SAVED = /role="status"[^>]*>[^<]*Saved\./;

/** Follows a 303 to where it points and returns that page's markup. */
async function landed(response: Response, who: Caller): Promise<{ where: string; html: string }> {
  expect(response.status).toBe(303);
  const where = response.headers.get('location') ?? '';
  return { where, html: await (await getPage(where, who)).text() };
}

describe('the page a succeeded form lands on says Saved once, and a refused form does not', () => {
  it('removing a passkey on /account lands on /account, which says Saved; the plain page and a refusal do not', async () => {
    const who = await caller();
    const first = await withPasskey(who.personId);
    const only = await withPasskey(who.personId);
    const { where, html } = await landed(
      await formPost('/account', 'auth.revokePasskey', who, { id: first }),
      who,
    );
    expect(where).toBe('/account?saved=1');
    expect(html).toMatch(SAVED);
    expect(await (await getPage('/account', who)).text()).not.toContain('Saved.');
    const refused = await formPost('/account', 'auth.revokePasskey', who, { id: only });
    expect(refused.status).not.toBe(303);
    expect(await refused.text()).not.toContain('Saved.');
  });

  it('saving the week with no script lands on the week, which says Saved', async () => {
    const b = await booking();
    const [task] = b.tasks;
    if (!task) return expect.unreachable('the booking has tasks');
    const rowId = await addRow(b.who, WEEK, b.projectId, task);
    const page = `/week/${WEEK}`;
    const posted = await formPost(page, 'entries.save', b.who, {
      weekStart: WEEK,
      ...cell(rowId, 0, '2'),
    });
    const { where, html } = await landed(posted, b.who);
    expect(where).toBe(`${page}?saved=1`);
    expect(html).toMatch(SAVED);
    expect(await (await getPage(page, b.who)).text()).not.toContain('Saved.');
  });

  it('returning a week lands on the approver page, which says Saved and that the week went back to the person', async () => {
    const b = await booking();
    const [task] = b.tasks;
    if (!task) return expect.unreachable('the booking has tasks');
    const rowId = await addRow(b.who, WEEK, b.projectId, task);
    expect((await save(b.who, WEEK, cell(rowId, 0, '3'))).status).toBe(200);
    expect((await rpcForm('submission.submit', b.who, { weekStart: WEEK })).status).toBe(200);
    const approver = await caller([ACCOUNTING]);
    const page = `/approvals/${b.who.personId}/${WEEK}`;
    const posted = await formPost(page, 'submission.return', approver, {
      personId: b.who.personId,
      weekStart: WEEK,
      reason: 'Check the hours',
    });
    const { where, html } = await landed(posted, approver);
    expect(where).toBe(`${page}?saved=1`);
    expect(html).toMatch(SAVED);
    expect(html).toContain('returned to the person to edit and submit again');
    expect(html).not.toContain('returned to you');
    const again = await formPost(page, 'submission.return', approver, {
      personId: b.who.personId,
      weekStart: WEEK,
      reason: 'Check the hours',
    });
    expect(again.status).not.toBe(303);
    expect(await again.text()).not.toContain('Saved.');
  });
});
