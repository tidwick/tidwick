import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // One worker: every ceremony appends to the one audit chain (a batch reads the head, then writes), so two
  // specs enrolling or saving at once make one batch lose the race and the page shows a false "link expired".
  workers: 1,
  webServer: { command: 'just preview', url: 'http://localhost:4321', reuseExistingServer: false },
  use: { baseURL: 'http://localhost:4321' },
  projects: [
    { name: 'phone', use: { viewport: { width: 390, height: 844 } } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
  ],
});
