import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

// Optional: values in .env.pilot override the defaults below.
dotenv.config({ path: path.resolve(__dirname, '.env.pilot') });

const BASE_URL = process.env.BANYAN_BASE_URL || 'https://staging.banyanliving.com';
const HTTP_USERNAME = process.env.BANYAN_HTTP_USERNAME || 'testuser';
const HTTP_PASSWORD = process.env.BANYAN_HTTP_PASSWORD || 'tEsT1nGPaSS';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 1,
  reporter: [['html', { open: 'never' }], ['list']],

  use: {
    baseURL: BASE_URL,

    // Staging is protected by HTTP Basic Auth; Playwright answers the prompt automatically.
    httpCredentials: {
      username: HTTP_USERNAME,
      password: HTTP_PASSWORD,
    },

    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1200 } },
    },
    {
      name: 'tablet',
      use: { ...devices['iPad (gen 7)'] },
    },
  ],
});