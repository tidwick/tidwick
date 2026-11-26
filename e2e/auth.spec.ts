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
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.locator('[data-code]')).toHaveCount(10);
  // The codes live in a short-lived server record, so a reload shows the same ten until they are acknowledged.
  const shown = await page.locator('[data-code]').allTextContents();
  await page.reload();
  expect(await page.locator('[data-code]').allTextContents()).toEqual(shown);
  await page.getByRole('button', { name: 'I have saved these codes' }).click();
  await expect(page.locator('[data-code]')).toHaveCount(0);
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
  // The dev server runs with MCP on: /mcp takes a POST with a bearer, so a browser's GET is a 405, not a page.
  expect((await page.goto('/mcp'))?.status()).toBe(405);
});

test('a used enrolment link is refused with a plain message', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one width is enough for a server message');
  await page.goto('/enrol/not-a-real-token');
  const status = page.getByRole('status');
  // The public auth limit is 30 a minute and the specs before this one may have used it up; a refusal waits out the window.
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByRole('button', { name: 'Create a passkey' }).click();
    await expect(status).toContainText(/expired or was already used|Too many attempts/);
    if (!(await status.innerText()).includes('Too many attempts')) break;
    test.setTimeout(test.info().timeout + 65_000);
    await page.waitForTimeout(30_000);
  }
  await expect(status).toContainText('expired or was already used');
});
