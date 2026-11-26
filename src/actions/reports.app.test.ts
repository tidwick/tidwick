// The /reports page and its CSV through the built Worker: an accounting admin reads sums by group and week state
// with no passkey confirmation and no audit event; notes never appear; the CSV keeps its own gate.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ACCOUNTING, ADMIN, MINUTE } from '../../test/helpers/auth';
import { bookedWeek, WEEK } from '../../test/helpers/booking';
import { caller, formPost, getPage, type Caller } from '../../test/helpers/callers';
import { eventsAfter, headSeq } from '../../test/helpers/reference';
import { saveCells } from '../db/entry-writes';
import { clientNameOf, renameClient, reportLabels, stampSubmission } from '../db/test-support-csv';
import { noteKeks } from '../lib/env';

const RANGE = 'from=2026-01-05&to=2026-01-11';
const view = (kind: string, who: Caller | null, range = RANGE) =>
  getPage(`/reports?${range}&kind=${kind}`, who);

/** A booked member whose week is in the given state, with four hours on Monday. */
async function weekIn(
  state: 'approved' | 'submitted' | 'returned' | null,
): Promise<Awaited<ReturnType<typeof bookedWeek>>> {
  const b = await bookedWeek();
  if (state !== null) await stampSubmission(env.DB, b.who.personId, WEEK, state);
  return b;
}

/** The table cells of the row that names `name`, by column label. */
function rowOf(html: string, name: string): Record<string, string> {
  const row =
    html
      .split('<tr')
      .slice(1)
      .find((r) => r.includes(name)) ?? '';
  const cells: Record<string, string> = {};
  for (const [, label = '', text = ''] of row.matchAll(
    /data-label="([^"]+)"[^>]*>\s*([^<]*?)\s*</g,
  ))
    cells[label] = text;
  return cells;
}

describe('viewing a report', () => {
  it('SEC-53 a member, a plain admin and a signed-out visitor see no report (negative case: accounting does)', async () => {
    const refused: [Caller | null, number][] = [
      [await caller(), 403],
      [await caller([ADMIN]), 403],
      [null, 303],
    ];
    for (const [who, status] of refused) {
      const response = await view('person', who);
      expect(response.status).toBe(status);
      expect(await response.text()).not.toContain('Download CSV');
    }
    expect((await view('person', await caller([ACCOUNTING]))).status).toBe(200);
  });

  it('needs no passkey confirmation and writes no audit event', async () => {
    await weekIn('approved');
    const before = await headSeq();
    const stale = await caller([ACCOUNTING], { stepUpAgo: 60 * MINUTE });
    const response = await view('week', stale);
    expect(response.status).toBe(200);
    expect(await eventsAfter(before)).toEqual([]);
  });

  it('a client row has a column for each week state, and the total row adds them', async () => {
    const states = ['draft', 'submitted', 'returned', 'approved'] as const;
    const made: Awaited<ReturnType<typeof weekIn>>[] = [];
    for (const s of states) made.push(await weekIn(s === 'draft' ? null : s));
    const who = await caller([ACCOUNTING]);
    const html = await (await view('client', who)).text();
    for (const [i, state] of states.entries()) {
      const name = await clientNameOf(env.DB, made[i]?.clientId ?? '');
      const cells = rowOf(html, name);
      const expected = { Draft: '0.00', Submitted: '0.00', Returned: '0.00', Approved: '0.00' };
      expect(cells, state).toMatchObject({
        ...expected,
        [state.charAt(0).toUpperCase() + state.slice(1)]: '4.00',
        Total: '4.00',
      });
    }
    const totals = rowOf(html.split('<tfoot')[1] ?? '', 'Total');
    const parts = [totals.Draft, totals.Submitted, totals.Returned, totals.Approved].map(Number);
    expect(Number(totals.Total)).toBeCloseTo(
      parts.reduce((a, b) => a + b, 0),
      2,
    );
    expect(Number(totals.Total)).toBeGreaterThanOrEqual(16);
    expect(html).toContain('<tfoot');
  });

  it('person, project, task and week reports group by their own columns', async () => {
    const b = await weekIn('approved');
    const who = await caller([ACCOUNTING]);
    const row = await reportLabels(env.DB, {
      personId: b.who.personId,
      projectId: b.projectId,
      taskId: b.tasks[0]?.id ?? '',
    });
    expect(rowOf(await (await view('person', who)).text(), row.email)).toMatchObject({
      Email: row.email,
      Approved: '4.00',
    });
    expect(rowOf(await (await view('project', who)).text(), row.project)).toMatchObject({
      Project: row.project,
    });
    expect(rowOf(await (await view('task', who)).text(), row.code)).toMatchObject({
      Task: row.task,
    });
    expect(rowOf(await (await view('week', who)).text(), '2026-01-05').Total).not.toBeUndefined();
  });

  it('a range with no hours shows an empty state and no table or chart', async () => {
    const html = await (
      await view('person', await caller([ACCOUNTING]), 'from=2020-01-06&to=2020-01-12')
    ).text();
    expect(html).toContain('No hours in that range');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('<svg role="img"');
    expect(html).toContain('Download CSV');
  });

  it('a reversed range says so and shows nothing', async () => {
    const response = await view(
      'person',
      await caller([ACCOUNTING]),
      'from=2026-01-11&to=2026-01-05',
    );
    const html = await response.text();
    expect(response.status).toBe(400);
    expect(html).toContain('the start date is after the end date');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('Download CSV');
  });

  it('shows no note, and escapes a name that holds markup', async () => {
    const b = await weekIn(null);
    await saveCells(
      b.member,
      env.DB,
      noteKeks(),
      WEEK,
      [{ rowId: b.rowId, dow: 1, hundredths: 100, note: 'zq-private-note' }],
      Date.now(),
    );
    await stampSubmission(env.DB, b.who.personId, WEEK, 'approved');
    await renameClient(env.DB, b.clientId, '<i>Acme</i> & "Co"');
    const who = await caller([ACCOUNTING]);
    for (const kind of ['client', 'project', 'person', 'task', 'week']) {
      expect(await (await view(kind, who)).text(), kind).not.toContain('zq-private-note');
    }
    const html = await (await view('client', who)).text();
    expect(html).toContain('&lt;i&gt;Acme&lt;/i&gt; &amp; &quot;Co&quot;');
    expect(html).not.toContain('<i>Acme</i>');
  });

  it('draws the chart with token classes only, and keeps the CSV buttons out of the date form', async () => {
    await weekIn('submitted');
    const html = await (await view('person', await caller([ACCOUNTING]))).text();
    const svg = /<svg role="img".*?<\/svg>/s.exec(html)?.[0] ?? '';
    expect(svg).toContain('<title id="report-chart-title">Hours by person</title>');
    expect(svg).toContain('<desc id="report-chart-desc">');
    expect(svg).toMatch(/class="fill-chart-2"/);
    expect(svg).not.toMatch(/style=|fill="/);
    // Enter in a date field submits the first form's first button, which only shows the report.
    expect(html).not.toContain('formaction');
    const forms = html
      .split('<form')
      .slice(1)
      .filter((f) => f.includes('name="from"'));
    expect(forms[0]).toContain('method="GET"');
    expect(forms[0]).not.toContain('/reports/');
    expect(forms[1]).toContain('method="POST" action="/reports/person.csv"');
    expect(forms[1]).toContain('name="_csrf"');
    expect(forms[1]).not.toContain('type="date"');
  });

  it('offers the passkey confirmation panel', async () => {
    const stale = await caller([ACCOUNTING], { stepUpAgo: 60 * MINUTE });
    expect(await (await view('person', stale)).text()).toContain('data-step-up="needed"');
    expect(await (await view('person', await caller([ACCOUNTING]))).text()).toContain(
      'data-step-up="current"',
    );
  });
});

describe('the CSV of each report', () => {
  it('has its own columns and rows, with formulas and commas escaped, and one event each', async () => {
    const b = await weekIn('approved');
    await renameClient(env.DB, b.clientId, '=SUM(A1), "x"');
    const who = await caller([ACCOUNTING]);
    const before = await headSeq();
    const heads: Record<string, string> = {
      person: 'Person,Email,State,Hours',
      client: 'Client,State,Hours',
      project: 'Client,Project,Project Number,State,Hours',
      task: 'Task Code,Task,State,Hours',
      week: 'Week Start,State,Hours',
    };
    for (const [kind, head] of Object.entries(heads)) {
      const response = await formPost(`/reports/${kind}.csv`, null, who, {
        from: '2026-01-05',
        to: '2026-01-11',
      });
      expect(response.status, kind).toBe(200);
      const rows = (await response.text()).trimEnd().split('\r\n');
      expect(rows[0], kind).toBe(head);
      expect(rows.length, kind).toBeGreaterThan(1);
      if (kind === 'client' || kind === 'project') {
        expect(rows.join('\n'), kind).toContain(`"'=SUM(A1), ""x"""`);
      }
    }
    expect((await eventsAfter(before)).map((e) => e.target)).toEqual(
      Object.keys(heads).map((k) => `report:${k}`),
    );
  });

  it('a stale confirmation answers a page that links back to the form, and writes no event', async () => {
    const stale = await caller([ACCOUNTING], { stepUpAgo: 60 * MINUTE });
    const before = await headSeq();
    for (const [path, back] of [
      ['/reports/person.csv', '/reports'],
      ['/export/some-client.csv', '/export'],
    ] as const) {
      const response = await formPost(path, null, stale, { from: '2026-01-05', to: '2026-01-11' });
      expect(response.status, path).toBe(403);
      expect(await response.text(), path).toMatch(new RegExp(`<a[^>]*href="${back}"[^>]*>Back to`));
    }
    expect(await eventsAfter(before)).toEqual([]);
  });
});
