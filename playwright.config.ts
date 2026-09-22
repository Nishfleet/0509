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
const devPort = process.env.PLAYWRIGHT_DEV_PORT ?? "8787";
const baseURL = process.env.PLAYWRIGHT_TEST_BASE_URL ?? `http://127.0.0.1:${devPort}`;
export const accessStatePath = "e2e/.auth/access.json";
const accessState = process.env.CF_ACCESS_CLIENT_ID ? { storageState: accessStatePath } : {};

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
  },
  // Production sits behind Cloudflare Access; only / and /api/health are
  // public. The setup project presents the agents' service token once and
  // saves the CF_Authorization cookie Access issues; the browser then sends
  // that cookie to 0509.io only, so third-party origins (fonts, the beacon)
  // never see an Access header and CORS stays quiet. Locally (no token) the
  // setup project is absent and tests run without it.
  projects: [
    ...(process.env.CF_ACCESS_CLIENT_ID ? [{ name: "setup", testMatch: /auth\.setup\.ts/ }] : []),
    {
      name: "desktop-1440",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, ...accessState },
      dependencies: process.env.CF_ACCESS_CLIENT_ID ? ["setup"] : [],
    },
    {
      name: "phone-390",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, ...accessState },
      dependencies: process.env.CF_ACCESS_CLIENT_ID ? ["setup"] : [],
    },
  ],
  webServer: process.env.PLAYWRIGHT_TEST_BASE_URL
    ? undefined
    : {
        command: `npx wrangler r2 object put 0509-snapshots/shot/e2e/capture-plate/before.png --file tests/fixtures/capture-before.png --local --content-type image/png -y && npx wrangler r2 object put 0509-snapshots/shot/e2e/capture-plate/after.png --file tests/fixtures/capture-after.png --local --content-type image/png -y && npx wrangler dev --port ${devPort} --local`,
        url: `http://127.0.0.1:${devPort}/api/health`,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
