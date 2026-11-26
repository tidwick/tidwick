import { expect, test } from '@playwright/test';
import { scan } from './axe';
import { enrol, tokenOf } from './enrol';

test('an admin saves the alert address and age limit, a bad value is refused with what was typed kept, and the signed-in pages pass axe', async ({
  page,
}, info) => {
  await enrol(page, tokenOf(`admin-set-${info.project.name}`));
  await page.goto('/admin/settings');

  await expect(page.locator('main#main')).toHaveCount(1);
  await page.locator('form[action*="settings.save"]').evaluate((f) => {
    (f as HTMLFormElement).noValidate = true;
  });
  await page.getByLabel('Backup age limit, in hours').fill('0');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('alert').getByText(/Enter whole hours from 1 to/)).toBeVisible();
  await expect(page.getByLabel('Backup age limit, in hours')).toHaveValue('0');
  await expect(page.getByText('Saved.')).toHaveCount(0);

  await page.getByLabel('Alert address').fill('alerts@practice.example');
  await page.getByLabel('Backup age limit, in hours').fill('36');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await expect(page.getByLabel('Alert address')).toHaveValue('alerts@practice.example');
  await expect(page.getByLabel('Backup age limit, in hours')).toHaveValue('36');
  await expect(page.locator('[data-status="alert-to"]')).toHaveText('alerts@practice.example');

  for (const path of [
    '/week',
    '/clients',
    '/approvals',
    '/reports',
    '/admin/people',
    '/admin/settings',
    '/account',
  ])
    await scan(page, path);
});
