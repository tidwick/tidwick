import { expect, test } from '@playwright/test';

test('the home page offers the sign-in and recovery links @smoke', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'tidwick' })).toBeVisible();
  await page.getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goBack();
  await expect(page.getByRole('link', { name: /recovery code/ })).toBeVisible();
});
