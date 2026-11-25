import { expect, test, type Page } from '@playwright/test';
import { enrol, tokenOf } from './enrol';

// Written by test/e2e/prepare.ts: one open enrolment link per grid member. Each member is assigned to the
// "Grid pavilion" project (tasks Design and Review) and has one row with hours in the week of 2031-02-24.

const WEEK = '/week/2031-03-03';
const hours = (page: Page, task: string, day: string) =>
  page.getByLabel(`Hours, Grid pavilion, ${task}, ${day}`);

test('a member copies last week, fills the week, adds a row and removes a blank one', async ({
  page,
}, info) => {
  await enrol(page, tokenOf(`grid-${info.project.name}`));
  await page.goto(WEEK);
  await expect(page.getByRole('heading', { name: 'Week of 3 March 2031' })).toBeVisible();
  await expect(page.getByText('No rows yet')).toBeVisible();

  // Copy last week brings the row across with no hours.
  await page.getByRole('button', { name: 'Copy last week' }).click();
  await expect(hours(page, 'Design', 'Monday')).toBeVisible();
  await expect(hours(page, 'Design', 'Monday')).toHaveValue('');
  await expect(page.getByRole('row', { name: /Day total/ })).toContainText('0');

  // Fill Monday to Friday; totals update as the cells change and again once the Action has answered.
  for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
    await hours(page, 'Design', day).fill('8');
    await hours(page, 'Design', day).blur();
  }
  await expect(page.getByLabel('Week total')).toHaveText('40');
  await hours(page, 'Design', 'Saturday').fill('2.5');
  await hours(page, 'Design', 'Saturday').blur();
  await expect(page.getByLabel('Week total')).toHaveText('42.5');

  // A note on a cell, entered in the row's ledger that Enter on the hours opens; Escape returns to the hours.
  await hours(page, 'Design', 'Monday').focus();
  await page.keyboard.press('Enter');
  await page
    .getByLabel('Note, Grid pavilion, Design, Monday')
    .fill('kick-off with <b>the team</b>');
  await page.keyboard.press('Escape');
  await expect(hours(page, 'Design', 'Monday')).toBeFocused();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  // The server refuses a day over 24 hours and the cell keeps what was typed.
  await hours(page, 'Design', 'Tuesday').fill('25');
  await hours(page, 'Design', 'Tuesday').blur();
  await expect(page.getByRole('alert')).toContainText('Tuesday');

  await hours(page, 'Design', 'Tuesday').fill('8');
  await hours(page, 'Design', 'Tuesday').blur();

  // Add row: a project, then one of its allowed tasks.
  await page
    .getByLabel('Add a row: project')
    .selectOption({ label: 'Harbour Studio Grid · Grid pavilion' });
  await page.getByLabel('Task on Grid pavilion').selectOption({ label: 'GRD-REV Review' });
  await page.getByRole('button', { name: 'Add row' }).click();
  await expect(hours(page, 'Review', 'Monday')).toBeVisible();

  // A row with hours cannot be removed; a blank one can.
  const designRow = page.getByRole('row', { name: /Design/ }).first();
  await expect(designRow.getByRole('button', { name: 'Remove' })).toBeDisabled();
  const reviewRow = page.getByRole('row').filter({ has: hours(page, 'Review', 'Monday') });
  await reviewRow.getByRole('button', { name: 'Remove' }).click();
  await expect(hours(page, 'Review', 'Monday')).toHaveCount(0);

  // Everything saved survives a reload, and the note is shown as text, not parsed.
  await page.reload();
  await expect(page.getByLabel('Week total')).toHaveText('42.5');
  await hours(page, 'Design', 'Monday').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Note, Grid pavilion, Design, Monday')).toHaveValue(
    'kick-off with <b>the team</b>',
  );
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // At phone width each row is a short card with a strip of days: nothing scrolls sideways, the row's project and task and
  // the day and week totals are in the page without scrolling the grid, and every hours input is 44px tall.
  if (info.project.name === 'phone') {
    const table = page.getByRole('table', { name: 'Hours by project, task and day' });
    const fits = await table.evaluate((el) => {
      const box = el.parentElement;
      return box !== null && box.scrollWidth <= box.clientWidth;
    });
    expect(fits).toBe(true);
    await expect(page.getByRole('rowheader', { name: /Grid pavilion/ }).first()).toBeInViewport();
    const totals = page.getByRole('row', { name: /Day total/ });
    await totals.scrollIntoViewIfNeeded();
    await expect(totals.getByRole('cell').first()).toBeInViewport();
    await expect(totals.getByRole('cell').last()).toBeInViewport();
    for (const box of await page.locator('input[name^="cell."]').all()) {
      expect((await box.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    // The week total sits in the bar that sticks to the foot of the window, at the top of the page too.
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await expect(page.getByLabel('Week total')).toBeInViewport();
  }
});
