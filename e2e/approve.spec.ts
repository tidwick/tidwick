import { expect, test } from '@playwright/test';
import { enrol, tokenOf } from './enrol';

// Written by test/e2e/prepare.ts: per Playwright project, a member with six hours on Monday of the week of
// 2031-03-10 (`submit-<project>`) and an accounting admin (`acct-<project>`), each with an open enrolment link.

const WEEK = '2031-03-10';

test('a member submits a week and an accounting admin approves it after a passkey confirmation', async ({
  page: member,
  browser,
}, info) => {
  const project = info.project.name;
  await enrol(member, tokenOf(`submit-${project}`));
  await member.goto(`/week/${WEEK}`);
  await member.getByRole('button', { name: 'Submit week' }).click();
  await expect(
    member.getByText('Submit 6 hours? The week locks until it is returned.'),
  ).toBeVisible();
  await member.getByRole('button', { name: 'Confirm submit' }).click();
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
  await admin.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(admin.getByText(/This week is approved;/)).toBeVisible();
  await expect(admin.getByText(/^Approved by .+ on \d{1,2} \w+ \d{4}\.$/)).toBeVisible();

  await admin.goto('/approvals');
  await expect(admin.getByRole('row').filter({ hasText: person })).toHaveCount(0);
  await member.reload();
  await expect(member.getByText('This week is approved and locked.')).toBeVisible();

  // Someone on the books who has handed in none of the last four weeks is chased, each week a link to their page.
  const missing = admin.getByRole('region', { name: 'Not submitted' });
  await expect(missing.getByText(person, { exact: true })).toBeVisible();
  await expect(missing.getByRole('link', { name: /^Week of / }).first()).toBeVisible();

  // The approved list reaches the week again, and a return needs its reason, which the owner then reads.
  await admin.goto('/approvals?state=approved');
  await admin
    .getByRole('row')
    .filter({ hasText: person })
    .getByRole('link', { name: `Open ${person}, week of ${WEEK}` })
    .click();
  await admin.getByRole('textbox', { name: 'Reason for returning' }).fill('Friday is missing');
  await admin.getByRole('button', { name: 'Return to the person' }).click();
  await expect(admin.getByText(/This week is returned to the person;/)).toBeVisible();
  await member.reload();
  await expect(member.getByText(/returned to you: .Friday is missing./)).toBeVisible();

  const overflow = await admin.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await own.close();
});
