// Runs in the `app` project, through the built Worker: how an approver reaches every state of a week and decides it,
// what the owner is told when a week comes back, and that a submit or a decision on a week that moved is refused.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ACCOUNTING, offboard, T0 } from '../../test/helpers/auth';
import {
  addRow,
  booking,
  bookedWeek,
  cell,
  save,
  weekOf,
  WEEK,
  type Booking,
} from '../../test/helpers/booking';
import { caller, formPost, getPage, rpcForm, type Caller } from '../../test/helpers/callers';
import { personById } from '../db/people';
import { scopeFor } from '../db/scope';
import { decideWeek, submitWeek } from '../db/submissions';
import { weekState } from '../db/week-view';
import { addDays, todayIn, weekStartOf } from '../lib/week';

type Week = Awaited<ReturnType<typeof bookedWeek>>;

const page = (who: Booking | Week) => `/approvals/${who.who.personId}/${WEEK}`;
const text = async (path: string, who: Caller): Promise<string> =>
  (await getPage(path, who)).text();
const decide = (event: 'approve' | 'return', who: Caller, w: Week, extra = {}) =>
  rpcForm(`submission.${event}`, who, { personId: w.who.personId, weekStart: WEEK, ...extra });

async function approver(): Promise<{ who: Caller; name: string }> {
  const who = await caller([ACCOUNTING]);
  return { who, name: (await personById(env.DB, who.personId))?.name ?? '' };
}

/** A person with the booked week submitted. */
async function submitted(): Promise<Week> {
  const w = await bookedWeek();
  await submitWeek(w.member, env.DB, WEEK, T0);
  return w;
}

describe('the approvals list reaches every state', () => {
  it('shows approved, returned and unsubmitted weeks under their own list, each with a way to open it', async () => {
    const { who } = await approver();
    const approved = await submitted();
    await decideWeek(approved.admin, env.DB, approved.who.personId, WEEK, 'approve', T0 + 1);
    const returned = await submitted();
    await decideWeek(returned.admin, env.DB, returned.who.personId, WEEK, 'return', T0 + 1);
    const draft = await bookedWeek();
    for (const [state, w] of [
      ['approved', approved],
      ['returned', returned],
      ['draft', draft],
    ] as const) {
      const html = await text(`/approvals?state=${state}`, who);
      expect(html, state).toContain(`href="${page(w)}"`);
      for (const other of [approved, returned, draft].filter((o) => o !== w)) {
        expect(html, state).not.toContain(`href="${page(other)}"`);
      }
    }
    const waiting = await text('/approvals', who);
    expect(waiting).not.toContain(`href="${page(approved)}"`);
  });

  it('an approved week opens with Return to the person, so approved to returned is reachable', async () => {
    const { who } = await approver();
    const w = await submitted();
    await decideWeek(w.admin, env.DB, w.who.personId, WEEK, 'approve', T0 + 1);
    const html = await text(page(w), who);
    expect(html).toContain('Return to the person');
    expect(html).not.toContain('>Approve<');
  });

  it('keeps the range and the state when a search runs, and a range keeps only its weeks', async () => {
    const { who } = await approver();
    const w = await submitted();
    const inside = await text(`/approvals?state=submitted&from=2026-01-05&to=2026-01-05`, who);
    expect(inside).toContain(`href="${page(w)}"`);
    expect(inside).toContain('name="from" value="2026-01-05"');
    const outside = await text(`/approvals?state=submitted&from=2026-01-12`, who);
    expect(outside).not.toContain(`href="${page(w)}"`);
  });

  it('says First 500 of N when the list was cut, and All N otherwise', async () => {
    const { who } = await approver();
    const w = await bookedWeek();
    const rows = `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 501) INSERT INTO week_submission (person_id, week_start, state, submitted_at) SELECT '${w.who.personId}', date('2000-01-03', '+' || (i * 7) || ' days'), 'returned', 1 FROM n;`;
    await env.DB.exec(rows);
    const cut = await text('/approvals?state=returned&from=2000-01-03', who);
    expect(cut).toMatch(/First 500 of \d{3,} weeks/);
    const all = await text('/approvals?state=returned&from=2000-01-03&to=2000-02-14', who);
    expect(all).toMatch(/All 6 weeks/);
  });
});

describe('the approver page', () => {
  it('names who approved and when, and links the weeks either side', async () => {
    const { who, name } = await approver();
    const w = await submitted();
    const scope = await scopeFor(env.DB, who.personId);
    await decideWeek(scope, env.DB, w.who.personId, WEEK, 'approve', T0);
    const html = await text(page(w), who);
    expect(html).toContain(`Approved by ${name} on 5 January 2026.`);
    expect(html).toContain(`href="/approvals/${w.who.personId}/2025-12-29"`);
    expect(html).toContain(`href="/approvals/${w.who.personId}/2026-01-12"`);
  });

  it('Approve and open next goes to the next waiting week, or back to the list when none follows', async () => {
    const { who } = await approver();
    const a = await submitted();
    const posted = (w: Week, fingerprint: string) =>
      formPost(page(w), 'submission.approve&next=1', who, {
        personId: w.who.personId,
        weekStart: WEEK,
        fingerprint,
      });
    const first = await posted(a, (await weekOf(a.who, WEEK)).fingerprint);
    expect(first.status).toBe(303);
    expect(first.headers.get('location')).toMatch(
      /^\/approvals(\/[\w-]+\/\d{4}-\d{2}-\d{2})?\?saved=1$/,
    );
    expect((await weekOf(a.who, WEEK)).state).toBe('approved');
    const plain = await submitted();
    const done = await formPost(page(plain), 'submission.approve', who, {
      personId: plain.who.personId,
      weekStart: WEEK,
    });
    expect(done.headers.get('location')).toBe(`${page(plain)}?saved=1`);
  });
});

describe('a return gives the owner its reason', () => {
  it('needs one, and the owner reads it on the week, which is first in the My weeks strip', async () => {
    const { who } = await approver();
    const b = await booking();
    // The strip looks at the weeks up to today, so this week is the one before this Monday.
    const week = addDays(weekStartOf(todayIn('UTC', Date.now())) ?? '', -7);
    const [task] = b.tasks;
    const rowId = await addRow(b.who, week, b.projectId, task ?? { id: '', code: '' });
    expect((await save(b.who, week, cell(rowId, 0, '3'))).status).toBe(200);
    expect((await rpcForm('submission.submit', b.who, { weekStart: week })).status).toBe(200);
    const fields = { personId: b.who.personId, weekStart: week };
    expect((await rpcForm('submission.return', who, fields)).status).toBe(400);
    expect((await weekOf(b.who, week)).state).toBe('submitted');
    const done = await rpcForm('submission.return', who, {
      ...fields,
      reason: 'Friday is missing',
    });
    expect(done.status).toBe(200);
    const html = await text(`/week/${week}`, b.who);
    expect(html).toContain('Friday is missing');
    const start = html.indexOf('aria-label="My weeks"');
    const strip = html.slice(start, html.indexOf('</nav>', start));
    expect(strip.indexOf('data-week-state="returned"')).toBeGreaterThan(-1);
    expect(strip.indexOf('data-week-state="returned"')).toBeLessThan(
      strip.indexOf('data-week-state="draft"'),
    );
    expect(await text(`/approvals/${b.who.personId}/${week}`, who)).toContain(
      '\u201cFriday is missing\u201d',
    );
  });

  it('a reason past 500 characters is refused', async () => {
    const { who } = await approver();
    const w = await submitted();
    expect((await decide('return', who, w, { reason: 'x'.repeat(501) })).status).toBe(400);
  });
});

describe('a decision or a submit on a week that moved is refused', () => {
  it('Approve and Return with the old fingerprint are 409 and change nothing; the current one lands', async () => {
    const { who } = await approver();
    const w = await submitted();
    const seen = (await weekOf(w.who, WEEK)).fingerprint;
    await env.DB.exec(
      `UPDATE entry SET hundredths = 900, updated_at = ${String(T0 + 50)} WHERE row_id = '${w.rowId}'`,
    );
    for (const event of ['approve', 'return'] as const) {
      const refused = await decide(event, who, w, { fingerprint: seen, reason: 'Check' });
      expect(refused.status, event).toBe(409);
    }
    expect((await weekOf(w.who, WEEK)).state).toBe('submitted');
    const fresh = (await weekOf(w.who, WEEK)).fingerprint;
    expect((await decide('approve', who, w, { fingerprint: fresh })).status).toBe(200);
    expect((await decide('approve', who, w, { fingerprint: 'garbage' })).status).toBe(400);
  });

  it('Submit with the fingerprint the owner confirmed lands; after another save it is a conflict', async () => {
    const w = await bookedWeek();
    const seen = (await weekOf(w.who, WEEK)).fingerprint;
    expect((await save(w.who, WEEK, cell(w.rowId, 2, '3'))).status).toBe(200);
    const refused = await rpcForm('submission.submit', w.who, {
      weekStart: WEEK,
      fingerprint: seen,
    });
    expect(refused.status).toBe(409);
    expect((await weekOf(w.who, WEEK)).state).toBe('draft');
    const now = (await weekOf(w.who, WEEK)).fingerprint;
    expect(
      (await rpcForm('submission.submit', w.who, { weekStart: WEEK, fingerprint: now })).status,
    ).toBe(200);
  });
});

describe('an offboarded person’s open week', () => {
  it('offers Approve on behalf, and approving it is audited as the approver’s', async () => {
    const { who } = await approver();
    const w = await bookedWeek();
    expect(await text(page(w), who)).not.toContain('Approve on behalf');
    await offboard(w.who.personId);
    const html = await text(page(w), who);
    expect(html).toContain('Approve on behalf');
    expect(html).not.toContain('Return to the person');
    expect((await decide('approve', who, w)).status).toBe(200);
    const reader = await scopeFor(env.DB, who.personId);
    expect(await weekState(reader, env.DB, w.who.personId, WEEK)).toBe('approved');
  });

  it('an approval on their behalf needs a fresh passkey confirmation; a stale one changes nothing', async () => {
    const w = await bookedWeek();
    await offboard(w.who.personId);
    const stale = await caller([ACCOUNTING], { stepUpAgo: 16 * 60_000 });
    expect((await decide('approve', stale, w)).status).toBe(403);
    const reader = await scopeFor(env.DB, stale.personId);
    expect(await weekState(reader, env.DB, w.who.personId, WEEK)).toBe('draft');
  });
});
