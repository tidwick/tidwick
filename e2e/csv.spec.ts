import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { enrol, tokenOf } from './enrol';

// Written by test/e2e/prepare.ts: per Playwright project, an accounting admin (`csv-<project>`) with an open
// enrolment link, and a member (`submit-<project>`) with a client, project and task the import file can name.

test('an accounting admin previews an import, saves a mapping and downloads a report', async ({
  page,
}, info) => {
  const project = info.project.name;
  await enrol(page, tokenOf(`csv-${project}`));

  await page.goto('/settings/csv');
  await expect(page.getByLabel('Export mapping')).toContainText('"header": "Batch"');
  await page.getByRole('button', { name: 'Save mappings' }).click();
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Import' }).click();
  await expect(page.getByLabel('CSV file')).toBeVisible();
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sideways).toBeLessThanOrEqual(0);
  const file = [
    'Day,Email,Client,Project,Job No,Activity,Hours,Remarks',
    `2031-03-17,submit-${project}@practice.example,Harbour Studio Grid,Grid pavilion,,GRD-DES,3.5,site visit`,
    `2031-03-18,nobody@practice.example,Harbour Studio Grid,Grid pavilion,,GRD-DES,1,`,
  ].join('\r\n');
  await page.getByLabel('CSV file').setInputFiles({
    name: 'timesheet.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(file),
  });
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByRole('heading', { name: 'Preview' })).toBeVisible();
  await expect(page.getByText('unknown person nobody@practice.example')).toBeVisible();
  await expect(page.getByText('Rows read')).toBeVisible();

  await page.goto('/account');
  // The page already says "Confirmed until" from sign-in, so the proof is the reload the confirmation causes.
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: 'Confirm with your passkey' }).click(),
  ]);
  await expect(page.getByText(/^Confirmed until/)).toBeVisible();

  await page.goto('/reports');
  await page.getByLabel('From').fill('2031-03-10');
  await page.getByLabel('To').fill('2031-03-16');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Hours by week' }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toMatch(/^report-week-2031-03-10-2031-03-16\.csv$/);
  const path = await saved.path();
  expect(readFileSync(path, 'utf8').split('\r\n')[0]).toBe('Week Start,State,Hours');
});
