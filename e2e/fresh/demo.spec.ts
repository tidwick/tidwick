import { expect, test } from '@playwright/test';

// The demo's seed loaded and its two flags on: the entry is a picker of invented people, and one click signs in.
// Each persona lands on /week, where the main navigation shows what that role can reach.
const PEOPLE = [
  { name: 'Bastian Vellacott', sees: ['Clients'], not: ['Approvals', 'Reports', 'People'] },
  { name: 'Quinn Everhart', sees: ['Clients'], not: ['Approvals', 'Reports', 'People'] },
  { name: 'Anwen Thornquist', sees: ['Approvals', 'Reports', 'Export'], not: ['People'] },
  { name: 'Calla Merriweather', sees: ['People', 'Settings'], not: ['Approvals', 'Reports'] },
];

test('the entry routes lead to the picker, which has no passkey step', async ({ page }) => {
  for (const path of ['/', '/login']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/demo$/);
  }
  await expect(page.getByRole('heading', { name: 'Try the demo' })).toBeVisible();
  await expect(page.getByText('Demo: resets daily at 04:00')).toBeVisible();
  await expect(page.getByRole('button', { name: /passkey/i })).toHaveCount(0);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  for (const { name } of PEOPLE) await expect(page.getByRole('button', { name })).toBeVisible();
});

for (const person of PEOPLE) {
  test(`clicking ${person.name} signs in and lands on their week`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: person.name }).click();
    await expect(page).toHaveURL(/\/week/);
    const nav = page.getByRole('navigation', { name: 'Main' });
    for (const link of person.sees)
      await expect(nav.getByRole('link', { name: link })).toBeVisible();
    for (const link of person.not)
      await expect(nav.getByRole('link', { name: link })).toHaveCount(0);
    await expect(page.getByText('Demo: resets daily at 04:00')).toBeVisible();
  });
}

test('the banner link switches person, and signing out returns to the picker', async ({ page }) => {
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Bastian Vellacott' }).click();
  await expect(page).toHaveURL(/\/week/);
  await page.getByRole('link', { name: 'Switch person' }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await page.getByRole('button', { name: 'Calla Merriweather' }).click();
  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'People' }),
  ).toBeVisible();
  await page.goto('/account');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/demo$/);
});

test.describe('with script off', () => {
  test.use({ javaScriptEnabled: false });

  test('the sign-in is a plain form and still works', async ({ page }) => {
    await page.goto('/demo');
    await page.getByRole('button', { name: 'Anwen Thornquist' }).click();
    await expect(page).toHaveURL(/\/week/);
  });
});
