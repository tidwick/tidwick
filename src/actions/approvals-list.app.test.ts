// Runs in the `app` project: the approvals list is one line per submitted week with the person in its first
// column. The name is drawn once per person, and a subtotal shows only for a person holding more than one week.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ACCOUNTING, T0 } from '../../test/helpers/auth';
import { addRow, bookedWeek, cell, NEXT, save, WEEK } from '../../test/helpers/booking';
import { caller, getPage } from '../../test/helpers/callers';
import { personById } from '../db/people';
import { submitWeek } from '../db/submissions';

/** A person with one submitted week, or two when `second` is set. */
async function submitted(second: boolean): Promise<{ email: string; name: string }> {
  const w = await bookedWeek();
  await submitWeek(w.member, env.DB, WEEK, T0);
  const task = w.tasks[0];
  if (second && task) {
    const rowId = await addRow(w.who, NEXT, w.projectId, task);
    await save(w.who, NEXT, cell(rowId, 1, '3'));
    await submitWeek(w.member, env.DB, NEXT, T0);
  }
  const person = await personById(env.DB, w.who.personId);
  return { email: person?.email ?? '', name: person?.name ?? '' };
}

const bodyRows = (html: string): string[] =>
  [...html.matchAll(/<tbody[\s\S]*?<\/tbody>/g)].flatMap(
    (body) => body[0].match(/<tr[\s\S]*?<\/tr>/g) ?? [],
  );
const SUBTOTAL = /\d+ weeks?, [\d.]+ hours/;

describe('the approvals list says each person once and each week once', () => {
  it('a person with two weeks gets two body rows, the name on the first and a subtotal beside it only', async () => {
    const two = await submitted(true);
    const who = await caller([ACCOUNTING]);
    const html = await (await getPage(`/approvals?q=${encodeURIComponent(two.email)}`, who)).text();
    const rows = bodyRows(html);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(SUBTOTAL);
    expect(rows[0]).toContain('2 weeks, 7 hours');
    expect(rows[0]).not.toContain('md:sr-only');
    expect(rows[1]).not.toMatch(SUBTOTAL);
    expect(rows[1]).toContain('md:sr-only');
    expect(rows[1]).toContain(two.name);
  });

  it('a person with one week is one row with no subtotal', async () => {
    const one = await submitted(false);
    const who = await caller([ACCOUNTING]);
    const html = await (await getPage(`/approvals?q=${encodeURIComponent(one.email)}`, who)).text();
    const rows = bodyRows(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain(one.name);
    expect(rows[0]).not.toMatch(SUBTOTAL);
  });

  it('the columns read person, week, submitted, hours, then the link to open it', async () => {
    await submitted(false);
    const who = await caller([ACCOUNTING]);
    const html = await (await getPage('/approvals', who)).text();
    const head = html.match(/<thead[\s\S]*?<\/thead>/)?.[0] ?? '';
    const names = [...head.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) =>
      (m[1] ?? '').replace(/<[^>]+>/g, '').trim(),
    );
    expect(names).toEqual(['Person', 'Week of', 'Submitted', 'Hours', 'Open']);
  });
});
