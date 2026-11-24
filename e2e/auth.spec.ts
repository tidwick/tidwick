import { expect, test } from '@playwright/test';
import { finishEnrol, startEnrol, tokenOf } from './enrol';

test('a person enrols a passkey, keeps the recovery codes, signs out and signs back in @smoke', async ({
  page,
}, info) => {
  await startEnrol(page, tokenOf(info.project.name));
  await expect(page.locator('[data-code]')).toHaveCount(10);
  await finishEnrol(page);
  await expect(page.getByText(`Signed in as Sample ${info.project.name} user`)).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(page).toHaveURL(/\/week/);
  await expect(page.getByText(`Signed in as Sample ${info.project.name} user`)).toBeVisible();
});

test('a used enrolment link is refused with a plain message', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one width is enough for a server message');
  await page.goto('/enrol/not-a-real-token');
  await page.getByRole('button', { name: 'Create a passkey' }).click();
  await expect(page.getByRole('status')).toContainText('expired or was already used');
});
