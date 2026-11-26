import { expect, test } from '@playwright/test';
import { enrol, tokenOf } from './enrol';

test('an admin edits a person, offboards them after a confirm step, and reinstates them', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'the journey is proved at desktop width');
  await enrol(page, tokenOf('admin-desktop'));
  const tag = String(Date.now());
  const email = `lifecycle.${tag}@practice.example`;

  await page.goto('/admin/people');
  await page.getByText('Add a person').click();
  await page.getByLabel('Name', { exact: true }).fill('Lifecycle Person');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('New firm name').fill(`Lifecycle Firm ${tag}`);
  await page.getByRole('button', { name: 'Add person' }).click();
  await expect(page.getByRole('heading', { name: 'Lifecycle Person' })).toBeVisible();

  await page.getByLabel('Name', { exact: true }).fill('Lifecycle Renamed');
  await page.getByLabel('Accounting system code').fill('LC-1');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByRole('heading', { name: 'Lifecycle Renamed' })).toBeVisible();
  await expect(page.getByText('LC-1')).toBeVisible();

  await page.getByLabel('Project', { exact: true }).selectOption({ index: 0 });
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  const removeOne = page.getByRole('button', { name: /^Remove Lifecycle Renamed from / });
  await expect(removeOne).toHaveCount(1);
  await removeOne.click();
  await expect(removeOne).toHaveCount(0);

  await page.getByRole('link', { name: 'Offboard' }).click();
  await expect(page.getByRole('heading', { name: 'Offboard Lifecycle Renamed?' })).toBeVisible();
  await page.getByRole('link', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Offboard Lifecycle Renamed?' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Offboard' }).click();
  await page.getByRole('button', { name: 'Confirm offboard' }).click();
  await expect(page).toHaveURL(/\/admin\/people\?saved=1/);

  await page.goto(`/admin/people?q=${encodeURIComponent(email)}`);
  await page.getByRole('link', { name: 'Lifecycle Renamed' }).click();
  await page.getByRole('button', { name: 'Reinstate' }).click();
  await expect(page.getByRole('link', { name: 'Offboard' })).toBeVisible();
  await expect(page.getByText('Not enrolled')).toBeVisible();
});
