import { expect, test } from '@playwright/test';
import { finishEnrol, startEnrol, tokenOf } from './enrol';

test('a person enrols a passkey, keeps the recovery codes, signs out and signs back in', async ({
  page,
}, info) => {
  await startEnrol(page, tokenOf(info.project.name));
  await expect(page.locator('[data-code]')).toHaveCount(10);
  await finishEnrol(page);
  await expect(page.getByText(`Signed in as Sample ${info.project.name} user`)).toBeVisible();

  await page.goto('/account');
  await page.getByRole('button', { name: 'Make new recovery codes' }).click();
  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  await expect(page.locator('[data-code]')).toHaveCount(10);
  await page.getByRole('checkbox', { name: /I have saved these codes/ }).check();
  await page.getByRole('link', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText('10 unused codes left.')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.goto('/clients');
  await expect(page).toHaveURL(/\/login\?return=%2Fclients$/);
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(page).toHaveURL(/\/clients$/);
  await expect(page.getByText(`Signed in as Sample ${info.project.name} user`)).toBeVisible();
  await page.goto('/clients/no-such-client');
  await expect(page.getByRole('heading', { name: 'Not found' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  // /mcp was cut from 0.1, so it is a path nobody built.
  expect((await page.goto('/mcp'))?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Not found' })).toBeVisible();
});

test('a used enrolment link is refused with a plain message', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one width is enough for a server message');
  await page.goto('/enrol/not-a-real-token');
  await page.getByRole('button', { name: 'Create a passkey' }).click();
  await expect(page.getByRole('status')).toContainText('expired or was already used');
});
