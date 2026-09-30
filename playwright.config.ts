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
export const onboardedStatePath = (lane: "desktop" | "phone"): string => `e2e/.auth/onboarded-${lane}.json`;
export const onboardedEmailPath = (lane: "desktop" | "phone"): string => `e2e/.auth/onboarded-${lane}.email`;
export const sessionStatePath = "e2e/.auth/session.json";
const accessState = process.env.CF_ACCESS_CLIENT_ID ? { storageState: accessStatePath } : {};
const productionLane = Boolean(process.env.PLAYWRIGHT_TEST_BASE_URL && process.env.CF_ACCESS_CLIENT_ID);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // https://playwright.dev/docs/ci#workers
  workers: process.env.PLAYWRIGHT_TEST_BASE_URL ? (process.env.CI ? 4 : undefined) : 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  // Production sits behind Cloudflare Access; only /, /privacy, /terms and /api/health are
  // public. The setup project presents the agents' service token once and
  // saves the CF_Authorization cookie Access issues; the browser then sends
  // that cookie to 0509.io only, so third-party origins (fonts, the beacon)
  // never see an Access header and CORS stays quiet. Locally (no token) the
  // setup project is absent and tests run without it. The session project
  // mints the shared better-auth session in the production lane and the
  // teardown deletes its account.
  projects: [
    ...(process.env.CF_ACCESS_CLIENT_ID ? [{ name: "setup", testMatch: /auth\.setup\.ts/ }] : []),
    ...(productionLane
      ? [
          {
            name: "session",
            testMatch: /(?:^|\/)session\.setup\.ts$/,
            dependencies: process.env.CF_ACCESS_CLIENT_ID ? ["setup"] : [],
            teardown: "session-teardown",
          },
          { name: "session-teardown", testMatch: /(?:^|\/)session\.teardown\.ts$/ },
        ]
      : []),
    // The lighthouse job's sign-in (0509#5767): a request-only setup that mints
    // a better-auth session cookie into GITHUB_ENV for lighthouserc.cjs. Gated
    // on its own env var so the e2e suite never runs it, and request-only so
    // the job needs no browser install.
    ...(process.env.LHCI_SESSION ? [{ name: "lhci-session", testMatch: /lhci-session\.setup\.ts/ }] : []),
    // The lighthouse job's post-audit teardown (0509#5767): deletes the address
    // the sign-in minted, via the product's own settings delete path. Gated on
    // its own env var so the e2e suite never runs it.
    ...(process.env.LHCI_TEARDOWN ? [{ name: "lhci-teardown", testMatch: /lhci-teardown\.setup\.ts/ }] : []),
    ...(process.env.CF_ACCESS_CLIENT_ID
      ? [
          {
            name: "onboarded-setup",
            testMatch: /onboarded\.setup\.ts/,
            dependencies: ["setup"],
            teardown: "onboarded-teardown",
          },
          { name: "onboarded-teardown", testMatch: /onboarded-teardown\.setup\.ts/ },
        ]
      : []),
    {
      name: "desktop-1440",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, ...accessState },
      dependencies: productionLane
        ? ["setup", "session", "onboarded-setup"]
        : process.env.CF_ACCESS_CLIENT_ID
          ? ["setup", "onboarded-setup"]
          : [],
      testIgnore: /onboarded.*\.setup\.ts/,
    },
    {
      name: "phone-390",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, ...accessState },
      dependencies: productionLane
        ? ["setup", "session", "onboarded-setup"]
        : process.env.CF_ACCESS_CLIENT_ID
          ? ["setup", "onboarded-setup"]
          : [],
      testIgnore: /onboarded.*\.setup\.ts/,
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
        //
        // wrangler.jsonc's vars pin BETTER_AUTH_URL to the production origin,
        // which would put the emailed magic link on https://0509.io — a link
        // the local Worker cannot verify. The stock --var override points the
        // link at this origin so the preview lane can follow it, and wrangler's
        // simulated send_email writes the message under .wrangler/tmp/email/
        // for e2e/inbox.ts to read instead of the inbox Worker (0509#6092).
        command: `npx wrangler d1 migrations apply 0509 --local </dev/null && npx wrangler dev --env-file .dev.vars.example --port ${localPort} --local --var "BETTER_AUTH_URL:http://127.0.0.1:${localPort}" --var "DODO_PRODUCT_STARTER:pdt_preview_starter"`,
        url: `http://127.0.0.1:${localPort}/api/health`,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
