import { defineConfig } from '@playwright/test';

export default defineConfig({
  // FRESH=setup or FRESH=claim runs that one spec from e2e/fresh/ against a bare instance (`just e2e`).
  testDir: './e2e',
  testMatch: process.env['FRESH']
    ? new RegExp(`/fresh/${process.env['FRESH']}[.]spec[.]ts$`)
    : /^(?!.*\/fresh\/).*\.spec\.ts$/,
  // One worker: every ceremony appends to the one audit chain (a batch reads the head, then writes), so two
  // specs enrolling or saving at once make one batch lose the race and the page shows a false "link expired".
  workers: 1,
  // A bare instance answers every page with an error until set up, so a fresh phase waits for the port, not a 2xx.
  webServer: {
    command: 'just preview',
    ...(process.env['FRESH'] ? { port: 4321 } : { url: 'http://localhost:4321' }),
    reuseExistingServer: false,
  },
  use: { baseURL: 'http://localhost:4321' },
  projects: [
    { name: 'phone', use: { viewport: { width: 390, height: 844 } } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
  ],
});
