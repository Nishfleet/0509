import { defineConfig, devices } from "@playwright/test";

// One config, two run modes, decided by PLAYWRIGHT_TEST_BASE_URL alone.
//
// Unset  -> Playwright starts the built Worker itself (webServer) and tests it.
//           This is what `preview-assert` does on every PR.
// Set    -> no webServer; the suite runs against that URL. This is what the
//           `deployment_status` run does against production.
//
// webServer's own doc says it is for "when you don't have a staging or
// production url to test against", which is exactly the split above:
// https://playwright.dev/docs/test-webserver
const baseURL = process.env.PLAYWRIGHT_TEST_BASE_URL ?? "http://127.0.0.1:8787";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // https://playwright.dev/docs/ci#workers
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    // Production sits behind Cloudflare Access; only / and /api/health are
    // public. CI passes the agents' service token as two secrets and Access
    // accepts them as headers on every request. Locally, unset means no headers.
    extraHTTPHeaders: process.env.CF_ACCESS_CLIENT_ID
      ? {
          "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID,
          "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET ?? "",
        }
      : undefined,
  },
  projects: [
    {
      name: "desktop-1440",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "phone-390",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: process.env.PLAYWRIGHT_TEST_BASE_URL
    ? undefined
    : {
        command: "npx wrangler dev --port 8787 --local",
        url: "http://127.0.0.1:8787/api/health",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
