import { expect, test } from '@playwright/test';
import { FIXTURE_DOMAIN } from '../test/local/local-dev.ts';
import { finishEnrol, startEnrol, tokenOf } from './enrol';

test('a person who lost their passkey signs in with one recovery code and is lands on the account page to add a new passkey', async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== 'desktop',
    'one width is enough; each sign-in counts against the public rate limit',
  );
  const name = `recover-${info.project.name}`;
  await startEnrol(page, tokenOf(name));
  const codes = await page.locator('[data-code]').allTextContents();
  expect(codes).toHaveLength(10);
  await finishEnrol(page);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();

  await page.goto('/recover');
  await page.getByLabel('Email').fill(`${name}@${FIXTURE_DOMAIN}`);
  await page.getByLabel('Recovery code').fill((codes[0] ?? '').trim());
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
});
