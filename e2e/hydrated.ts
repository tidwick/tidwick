import { expect, type Page } from '@playwright/test';

// Astro drops an island's `ssr` attribute once it has hydrated. A click before that posts the no-script form
// instead of asking first, so a spec waits here before it acts on the week grid.
export async function hydrated(page: Page): Promise<void> {
  await expect(page.locator('astro-island[ssr]')).toHaveCount(0);
}
