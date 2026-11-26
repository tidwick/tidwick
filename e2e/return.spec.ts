import { expect, test } from '@playwright/test';
import { enrol, tokenOf } from './enrol';
import { hydrated } from './hydrated';

// Written by test/e2e/prepare.ts: per Playwright project, a member with six hours on Monday of the week of
// 2031-03-17 (`ret-<project>`) and an accounting admin (`retacct-<project>`), each with an open enrolment link.

const WEEK = '2031-03-17';
const REASON = 'Monday is too short';

test('a returned week shows its reason to the owner, who edits and resubmits it back to the approver', async ({
  page: member,
  browser,
}, info) => {
  const project = info.project.name;
  const person = `Sample ret-${project} user`;
  await enrol(member, tokenOf(`ret-${project}`));
  await member.goto(`/week/${WEEK}`);
  await hydrated(member);
  await member.getByRole('button', { name: 'Submit week' }).click();
  await member.getByRole('button', { name: 'Confirm submit' }).click();
  await expect(member.getByText('Submitted; the week is locked')).toBeVisible();

  const own = await browser.newContext({
    baseURL: 'http://localhost:4321',
    viewport: member.viewportSize(),
  });
  const admin = await own.newPage();
  await enrol(admin, tokenOf(`retacct-${project}`));
  await admin.goto('/account');
  await Promise.all([
    admin.waitForEvent('load'),
    admin.getByRole('button', { name: 'Confirm with your passkey' }).click(),
  ]);
  await admin.goto('/approvals');
  await admin.getByRole('link', { name: `Open ${person}, week of ${WEEK}` }).click();
  await admin.getByRole('textbox', { name: 'Reason for returning' }).fill(REASON);
  await admin.getByRole('button', { name: 'Return to the person' }).click();
  await expect(admin.getByText(/This week is returned to the person;/)).toBeVisible();

  // The owner reads the reason, the week is open again, and an edit plus a resubmit puts it back in the queue.
  await member.reload();
  await hydrated(member);
  await expect(member.getByText(`returned to you: “${REASON}”`)).toBeVisible();
  const monday = member.getByLabel('Hours, Grid pavilion, Design, Monday');
  await expect(monday).toBeEditable();
  await monday.fill('7.5');
  await monday.blur();
  await expect(member.getByLabel('Week total')).toHaveText('7.5');
  await member.getByRole('button', { name: 'Submit week' }).click();
  await expect(member.getByText('Submit 7.5 hours?')).toBeVisible();
  await member.getByRole('button', { name: 'Confirm submit' }).click();
  await expect(member.getByText('Submitted; the week is locked')).toBeVisible();

  await admin.goto('/approvals');
  const listed = admin.getByRole('row').filter({ hasText: person });
  await expect(listed).toContainText(WEEK);
  await expect(listed).toContainText('7.5');
  await own.close();
});
