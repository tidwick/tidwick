import { expect, test } from '@playwright/test';
import { enrol, tokenOf } from './enrol';

// Written by test/e2e/prepare.ts: per Playwright project, a member with six hours on Monday of the week of
// 2031-03-10 (`submit-<project>`) and an accounting admin (`acct-<project>`), each with an open enrolment link.

const WEEK = '2031-03-10';

test('a member submits a week and an accounting admin approves it after a passkey confirmation @smoke', async ({
  page: member,
  browser,
}, info) => {
  const project = info.project.name;
  await enrol(member, tokenOf(`submit-${project}`));
  await member.goto(`/week/${WEEK}`);
  await member.getByRole('button', { name: 'Submit week' }).click();
  await expect(member.getByText('Submitted; the week is locked')).toBeVisible();
  await member.reload();
  await expect(member.getByText('This week is submitted and locked.')).toBeVisible();
  await expect(member.getByRole('button', { name: 'Submit week' })).toHaveCount(0);

  // The accounting admin signs in from a browser of their own, at the same width.
  const own = await browser.newContext({
    baseURL: 'http://localhost:4321',
    viewport: member.viewportSize(),
  });
  const admin = await own.newPage();
  await enrol(admin, tokenOf(`acct-${project}`));
  await admin.goto('/account');
  // The page already says "Confirmed until" from sign-in, so the proof is the reload the confirmation causes.
  await Promise.all([
    admin.waitForEvent('load'),
    admin.getByRole('button', { name: 'Confirm with your passkey' }).click(),
  ]);
  await expect(admin.getByText(/^Confirmed until/)).toBeVisible();

  const person = `Sample submit-${project} user`;
  await admin.goto('/approvals');
  const listed = admin.getByRole('row').filter({ hasText: person });
  await expect(listed).toContainText(WEEK);
  await expect(listed).toContainText('6');
  await listed.getByRole('link', { name: `Open ${person}, week of ${WEEK}` }).click();
  await expect(
    admin.getByRole('heading', { name: `${person}, week of 10 March 2031` }),
  ).toBeVisible();
  await expect(admin.getByText('submitted, waiting for approval')).toBeVisible();
  await admin.getByRole('button', { name: 'Approve' }).click();
  await expect(admin.getByText(/This week is approved;/)).toBeVisible();

  await admin.goto('/approvals');
  await expect(admin.getByRole('row').filter({ hasText: person })).toHaveCount(0);
  await member.reload();
  await expect(member.getByText('This week is approved and locked.')).toBeVisible();

  const overflow = await admin.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await own.close();
});
