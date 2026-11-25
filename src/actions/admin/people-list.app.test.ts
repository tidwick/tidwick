// Runs in the `app` project: the people list does not shout about a normal state. A person who has not enrolled yet
// is a heads-up, not a fault, and role names read in sentence case beside "Member".
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ACCOUNTING, ADMIN } from '../../../test/helpers/auth';
import { caller, getPage } from '../../../test/helpers/callers';
import { personById } from '../../db/people';

const rowOf = (html: string, email: string): string =>
  (html.match(/<tr[\s\S]*?<\/tr>/g) ?? []).find((row) => row.includes(email)) ?? '';

describe('the people list names a normal state calmly', () => {
  it('a person who has not enrolled reads Not enrolled in the notice tone, never the danger tone', async () => {
    const admin = await caller([ADMIN]);
    const person = await personById(env.DB, admin.personId);
    const html = await (
      await getPage(`/admin/people?q=${encodeURIComponent(person?.email ?? '')}`, admin)
    ).text();
    const row = rowOf(html, person?.email ?? 'unreachable');
    expect(row).toContain('Not enrolled');
    expect(row).toContain('bg-notice-surface');
    expect(row).not.toContain('No access yet');
    expect(row).not.toContain('bg-danger-surface');
  });

  it('role names start with a capital, the same as Member', async () => {
    const admin = await caller([ADMIN]);
    const other = await caller([ACCOUNTING]);
    const person = await personById(env.DB, other.personId);
    const html = await (
      await getPage(`/admin/people?q=${encodeURIComponent(person?.email ?? '')}`, admin)
    ).text();
    const row = rowOf(html, person?.email ?? 'unreachable');
    expect(row).toContain('>Accounting admin<');
    expect(row).not.toContain('accounting admin');
  });

  it('the person page lets an email break only where a word cannot fit, not mid-word', async () => {
    const admin = await caller([ADMIN]);
    const html = await (await getPage(`/admin/people/${admin.personId}`, admin)).text();
    const person = await personById(env.DB, admin.personId);
    const field = html
      .match(/<dd class="([^"]*)">[^<]*/g)
      ?.find((d) => d.includes(person?.email ?? ''));
    expect(field).toBeDefined();
    expect(field).not.toContain('break-all');
  });
});
