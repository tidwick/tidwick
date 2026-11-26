import { expect, test } from '@playwright/test';
import { scan } from './axe';

test('the signed-out pages have no axe violations, and a skip link reaches the content', async ({
  page,
}) => {
  for (const path of ['/', '/login', '/recover']) await scan(page, path);
  await page.goto('/login');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to the content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
  await expect(page.locator('main#main')).toBeInViewport();
});
