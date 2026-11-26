import { expect, test } from '@playwright/test';

test('the home page offers the sign-in and recovery links', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'tidwick' })).toBeVisible();
  await page.getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goBack();
  await expect(page.getByRole('link', { name: /recovery code/ })).toBeVisible();
});

test.describe('with script off', () => {
  test.use({ javaScriptEnabled: false });

  test('sign-in says it needs script and the recovery form still works as a plain form', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'one width is enough');
    await page.goto('/login');
    await expect(page.getByText(/needs JavaScript/)).toBeVisible();
    await page.getByRole('link', { name: /recovery code/ }).click();
    await page.getByLabel('Email').fill('nobody@practice.example');
    await page.getByLabel('Recovery code').fill('not-a-real-code');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('#recover-problem')).toBeVisible();
  });
});
