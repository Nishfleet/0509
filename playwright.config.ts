import { defineConfig, devices } from "@playwright/test";

// One config, two run modes, decided by PLAYWRIGHT_TEST_BASE_URL alone.
//
// Unset  -> Playwright starts the built Worker itself (webServer) and tests it.
//           This is `npm run e2e` on a laptop.
// Set    -> no webServer; the suite runs against that URL. `preview-assert`
//           sets it to the PR head's Worker Preview deployment URL; the
//           `deployment_status` run sets it to production.
//
// webServer's own doc says it is for "when you don't have a staging or
// production url to test against", which is exactly the split above:
// https://playwright.dev/docs/test-webserver
// The local port is per process, not a constant. This host runs many worker
// checkouts and the fleet-ci runners side by side and every one of them starts
// wrangler dev; a fixed 8787 let one run hold the port another needed (merge-group
// runs 35748807411, 35748988620, 35748501334: "8787 is already used"). The value
// is pinned in the environment so Playwright worker processes, which reload this
// file, see the same port the runner started the server on.
process.env.PLAYWRIGHT_LOCAL_PORT ??= String(8000 + (process.pid % 1000));
const localPort = process.env.PLAYWRIGHT_LOCAL_PORT;
const baseURL = process.env.PLAYWRIGHT_TEST_BASE_URL ?? `http://127.0.0.1:${localPort}`;
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
        // The local D1 starts empty, so `auth.api.getSession` throws a schema
        // mismatch instead of redirecting and preview never exercises the
        // session gate production does. Apply the same migrations
        // deploy-production.yml applies --remote, then start the Worker. This
        // is the stock `wrangler d1 migrations apply`; no wrapper.
        command: `npx wrangler d1 migrations apply 0509 --local </dev/null && npx wrangler dev --port ${localPort} --local`,
        url: `http://127.0.0.1:${localPort}/api/health`,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
