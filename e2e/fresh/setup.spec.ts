import { expect, test } from '@playwright/test';

// No secrets and an empty database: `/setup` names what is missing and makes the four values in the browser.
test('a bare instance generates its secrets and offers one kit', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(e.message));

  await page.goto('/setup');
  await page.getByRole('button', { name: 'Generate in this browser' }).click();
  for (const name of ['SESSION_SECRET', 'NOTE_KEK', 'BACKUP_RECIPIENT', 'SETUP_TOKEN'])
    await expect(page.locator(`[data-field="${name}"]`)).not.toHaveValue('');

  await expect(page.getByRole('status')).toContainText('kit is ready');
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download kit' }).click();
  expect((await download).suggestedFilename()).toBe('tidwick-kit.txt');
  expect(problems).toEqual([]);
});
