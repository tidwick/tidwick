import { expect, test, type Page } from '@playwright/test';
import { enrol, tokenOf } from './enrol';

/** The form that holds this button, so a label is looked up inside one form only. */
const formWith = (page: Page, button: string) =>
  page.locator('form', { has: page.getByRole('button', { name: button, exact: true }) });

test('an admin adds a client and a project with two allowed tasks and assigns a person, at phone width', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'phone', 'the journey is proved at phone width');
  await enrol(page, tokenOf('admin-phone'));
  const tag = 'Phone';

  await page.goto('/admin/task-codes');
  for (const [code, name] of [
    [`DES-${tag}`, 'Design'],
    [`REV-${tag}`, 'Review'],
  ] as const) {
    const form = formWith(page, 'Add task code');
    await form.getByLabel('Code').fill(code);
    await form.getByLabel('Name').fill(name);
    await form.getByRole('button', { name: 'Add task code' }).click();
    await expect(page.getByText(code, { exact: true })).toBeVisible();
  }

  await page.goto('/clients');
  await formWith(page, 'Add client').getByLabel('Name').fill(`Harbour Studio ${tag}`);
  await formWith(page, 'Add client').getByRole('button', { name: 'Add client' }).click();
  await expect(page.getByRole('heading', { name: `Harbour Studio ${tag}` })).toBeVisible();

  const projectForm = formWith(page, 'Add project');
  await projectForm.getByLabel('Project name').fill('Pavilion fit-out');
  await projectForm.getByLabel('Project number').fill('26-0901');
  await projectForm.getByRole('button', { name: 'Add project' }).click();
  await expect(page.getByRole('heading', { name: 'Pavilion fit-out' })).toBeVisible();
  await expect(page.getByText('26-0901')).toBeVisible();

  await page.getByLabel(`DES-${tag} · Design`).check();
  await page.getByLabel(`REV-${tag} · Review`).check();
  await page.getByRole('button', { name: 'Save allowed tasks' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: `DES-${tag} · Design` })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: `REV-${tag} · Review` })).toBeVisible();

  await page
    .getByLabel('Person')
    .selectOption({ label: 'Sample phone user (phone@practice.example)' });
  await page.getByRole('button', { name: 'Assign' }).click();
  // The creator is assigned to the project too, so the longer admin address holds this one as a substring.
  await expect(page.getByText('phone@practice.example', { exact: true })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
