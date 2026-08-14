import { defineConfig, devices } from '@playwright/test';

const basePathSegment = String(process.env.E2E_BASE_PATH || '/page-builder/')
  .replace(/^\/+|\/+$/g, '');
const basePath = basePathSegment ? `/${basePathSegment}/` : '/';
const origin = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173';
const baseURL = new URL(basePath, origin).toString();

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
    extraHTTPHeaders: process.env.E2E_ACCESS_TOKEN
      ? { Authorization: `Bearer ${process.env.E2E_ACCESS_TOKEN}` }
      : {},
  },
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: `VITE_BASE_PATH=${basePath} VITE_DEMO_MODE=true npm run dev -- --host 127.0.0.1 --port 4173`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
