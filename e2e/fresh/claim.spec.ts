import { expect, test } from '@playwright/test';
import { finishEnrol, startEnrol } from '../enrol';

// Secrets set, SETUP_TOKEN set, an empty database: the token claims the first admin once.
test('the setup token claims the first admin, enrols a passkey, and a second claim is refused', async ({
  page,
}) => {
  await page.goto('/setup');
  await page.getByLabel('Setup token').fill(process.env['SETUP_TOKEN'] ?? '');
  await page.getByLabel('Your email').fill('first@example.com');
  await page.getByLabel('Your name').fill('First Admin');
  await page.getByLabel('Your firm').fill('Example Practice');
  await page.getByRole('button', { name: 'Create the first admin' }).click();
  await expect(page).toHaveURL(/\/enrol\//);

  // The claim redirected to the enrolment link; startEnrol opens it again and creates the passkey.
  await startEnrol(page, new URL(page.url()).pathname.replace('/enrol/', ''));
  await finishEnrol(page);
  await expect(page.getByText('Signed in as First Admin')).toBeVisible();

  expect((await page.goto('/setup'))?.status()).toBe(404);
});
