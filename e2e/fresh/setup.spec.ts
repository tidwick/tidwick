import { expect, test } from '@playwright/test';

// No secrets and an empty database: `/setup` names what is missing and makes the three values in the browser.
test('a bare instance generates its three secrets and offers the backup key', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(e.message));

  await page.goto('/setup');
  await page.getByRole('button', { name: 'Generate in this browser' }).click();
  for (const name of ['SESSION_SECRET', 'NOTE_KEK', 'BACKUP_RECIPIENT'])
    await expect(page.locator(`[data-field="${name}"]`)).not.toHaveValue('');

  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download backup-key.txt' }).click();
  expect((await download).suggestedFilename()).toBe('backup-key.txt');
  expect(problems).toEqual([]);
});
