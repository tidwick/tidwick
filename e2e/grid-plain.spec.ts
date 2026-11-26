import { expect, test, type Page } from '@playwright/test';
import { enrol, tokenOf } from './enrol';

// With script off the grid is plain forms. Written by test/e2e/prepare.ts: a member (`plain-<project>`) assigned to
// "Grid pavilion" with a blank Design row and a blank Review row in the week of 2031-03-24.

const WEEK = '/week/2031-03-24';
const hours = (page: Page, task: string, day: string) =>
  page.getByLabel(`Hours, Grid pavilion, ${task}, ${day}`);

test('with no script, Remove and a refused save keep what was typed, and Submit saves the week first', async ({
  page,
  browser,
}, info) => {
  await enrol(page, tokenOf(`plain-${info.project.name}`));
  const plain = await browser.newContext({
    baseURL: 'http://localhost:4321',
    viewport: info.project.use.viewport ?? null,
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
  });
  const view = await plain.newPage();
  await view.goto(WEEK);
  await expect(hours(view, 'Review', 'Monday')).toBeVisible();

  // Remove posts the whole grid: the hours typed in the other row are saved, and the blank row goes.
  await hours(view, 'Design', 'Monday').fill('5');
  const review = view.getByRole('row').filter({ has: hours(view, 'Review', 'Monday') });
  await review.getByRole('button', { name: 'Remove' }).click();
  await expect(hours(view, 'Review', 'Monday')).toHaveCount(0);
  await expect(hours(view, 'Design', 'Monday')).toHaveValue('5');

  // A save the server refuses shows its message with every typed cell still in its field.
  await hours(view, 'Design', 'Tuesday').fill('30');
  await hours(view, 'Design', 'Wednesday').fill('2');
  await view.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(view.getByRole('alert')).toContainText('Tuesday');
  await expect(hours(view, 'Design', 'Tuesday')).toHaveValue('30');
  await expect(hours(view, 'Design', 'Wednesday')).toHaveValue('2');
  await expect(hours(view, 'Design', 'Monday')).toHaveValue('5');

  // Submit saves what is typed, then locks the week with it.
  await hours(view, 'Design', 'Tuesday').fill('1');
  await view.getByRole('button', { name: 'Submit week' }).click();
  await expect(view.getByText('This week is submitted and locked.')).toBeVisible();
  await expect(view.getByLabel('Week total')).toHaveText('8');
  await plain.close();
});
