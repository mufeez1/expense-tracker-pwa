import { defineConfig, devices } from '@playwright/test';

// Runs against the production build so the service worker (offline mode) is active.
// Set E2E_BASE_URL to test a deployed site instead, e.g. E2E_BASE_URL=https://example.netlify.app npm run e2e
const remote = process.env['E2E_BASE_URL'];

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  fullyParallel: true,
  use: { baseURL: remote ?? 'http://localhost:4300', channel: 'chrome', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 860 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: 'chrome' } },
  ],
  webServer: remote ? undefined : { command: 'npm run build && node scripts/serve.mjs 4300', url: 'http://localhost:4300', reuseExistingServer: true, timeout: 180_000 },
});
