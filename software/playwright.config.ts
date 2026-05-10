import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/ui",
  testMatch: "**/*.pw.ts",
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 7_500
  },
  use: {
    baseURL: "http://127.0.0.1:5175",
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "rm -rf .tmp/playwright-data && SEEKR_AI_PROVIDER=rules SEEKR_DATA_DIR=.tmp/playwright-data PORT=8790 SEEKR_API_PORT=8790 SEEKR_CLIENT_PORT=5175 npm run dev",
    url: "http://127.0.0.1:5175",
    reuseExistingServer: false,
    timeout: 45_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
