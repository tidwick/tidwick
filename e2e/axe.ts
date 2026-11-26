import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** Opens the path and fails on any WCAG 2.x A or AA violation axe finds, naming the rule and the elements. */
export const scan = async (page: Page, path: string): Promise<void> => {
  await page.goto(path);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    path,
  ).toEqual([]);
};
