import { defineConfig, devices } from "@playwright/test";
import {
  buildLocalReleaseServerCommand,
  isLocalReleaseServerIdentity,
  parseExactLoopbackOrigin,
} from "./scripts/local-release-server.mjs";

const shouldStartLocalServer = process.env.E2E_START_LOCAL_SERVER === "1";
const strictReleaseProof = process.env.E2E_RELEASE_STRICT === "1";
if (strictReleaseProof && !process.env.E2E_BASE_URL) {
  throw new Error("E2E_BASE_URL is required for an isolated local release run.");
}
const localBaseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4179";
const parsedLocalBaseURL = parseExactLoopbackOrigin(localBaseURL);
const previewBaseURL = process.env.E2E_PREVIEW_BASE_URL ?? localBaseURL;
const productionBaseURL = process.env.E2E_PROD_BASE_URL ?? "https://0509.io";
const authState = process.env.AUTH_STATE ?? ".auth/0509-internal.json";
const journeyReleaseMatch = /journey-[1-6]-release\.spec\.ts/;
const releaseServerIdentity = process.env.PLAYWRIGHT_RELEASE_SERVER_ID;
if (strictReleaseProof && !isLocalReleaseServerIdentity(releaseServerIdentity)) {
  throw new Error("PLAYWRIGHT_RELEASE_SERVER_ID is required for an isolated local release run.");
}
const outputDir = strictReleaseProof
  ? `test-results/e2e/${releaseServerIdentity}`
  : "test-results/e2e";

export default defineConfig({
  testDir: "./e2e",
  outputDir,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: strictReleaseProof
    ? [["list"], ["./scripts/playwright-release-manifest-reporter.mjs", { strict: true }]]
    : process.env.CI
      ? [["dot"], ["html", { open: "never" }]]
      : "list",
  timeout: 30_000,
  use: {
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: shouldStartLocalServer
      ? {
        command: buildLocalReleaseServerCommand(parsedLocalBaseURL.origin),
        reuseExistingServer: false,
        timeout: 120_000,
        url: localBaseURL,
      }
    : undefined,
  projects: [
    {
      name: "local-auth",
      // Landing-language live-proof captures ride the same local fixture
      // server and skip themselves unless their package flag is set, so
      // ordinary local-auth runs are unaffected.
      testMatch:
        /(local-authenticated|bl030-capture|bl034-capture|bl040-capture)\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: localBaseURL,
      },
    },
    {
      name: "local-release",
      testMatch: journeyReleaseMatch,
      retries: 0,
      workers: 1,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: localBaseURL,
      },
    },
    {
      name: "local-release-firefox",
      testMatch: journeyReleaseMatch,
      // Cross-browser risk proofs run on a shared CI runner where WebKit
      // starves under load: three consecutive deploy runs each timed out ONE
      // rotating journey (J2-tablet, J5-mobile, then J1-mobile) at ~32s while
      // every previously-failed test passed on the next run. Retries prove
      // "this journey CAN pass on this engine" — the proof's actual claim —
      // without letting a coin-flip runner block production. The canonical
      // chromium local-release lane stays retries: 0.
      retries: 2,
      workers: 1,
      use: {
        ...devices["Desktop Firefox"],
        baseURL: localBaseURL,
      },
    },
    {
      name: "local-release-webkit",
      testMatch: journeyReleaseMatch,
      // Cross-browser risk proofs run on a shared CI runner where WebKit
      // starves under load: three consecutive deploy runs each timed out ONE
      // rotating journey (J2-tablet, J5-mobile, then J1-mobile) at ~32s while
      // every previously-failed test passed on the next run. Retries prove
      // "this journey CAN pass on this engine" — the proof's actual claim —
      // without letting a coin-flip runner block production. The canonical
      // chromium local-release lane stays retries: 0.
      retries: 2,
      workers: 1,
      use: {
        ...devices["Desktop Safari"],
        baseURL: localBaseURL,
      },
    },
    {
      name: "local-release-mobile-safari",
      testMatch: journeyReleaseMatch,
      // Cross-browser risk proofs run on a shared CI runner where WebKit
      // starves under load: three consecutive deploy runs each timed out ONE
      // rotating journey (J2-tablet, J5-mobile, then J1-mobile) at ~32s while
      // every previously-failed test passed on the next run. Retries prove
      // "this journey CAN pass on this engine" — the proof's actual claim —
      // without letting a coin-flip runner block production. The canonical
      // chromium local-release lane stays retries: 0.
      retries: 2,
      workers: 1,
      use: {
        ...devices["iPhone 15"],
        baseURL: localBaseURL,
      },
    },
    {
      name: "local-release-mobile-chrome",
      testMatch: journeyReleaseMatch,
      // Cross-browser risk proofs run on a shared CI runner where WebKit
      // starves under load: three consecutive deploy runs each timed out ONE
      // rotating journey (J2-tablet, J5-mobile, then J1-mobile) at ~32s while
      // every previously-failed test passed on the next run. Retries prove
      // "this journey CAN pass on this engine" — the proof's actual claim —
      // without letting a coin-flip runner block production. The canonical
      // chromium local-release lane stays retries: 0.
      retries: 2,
      workers: 1,
      use: {
        ...devices["Pixel 7"],
        baseURL: localBaseURL,
      },
    },
    {
      name: "preview-public",
      testMatch: /prod-public\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: previewBaseURL,
        trace: "retain-on-failure",
        video: "off",
      },
    },
    {
      name: "prod-public",
      testMatch: /prod-public\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: productionBaseURL,
        trace: "retain-on-failure",
        video: "off",
      },
    },
    {
      name: "prod-auth",
      testMatch: /prod-authenticated\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: productionBaseURL,
        storageState: authState,
        screenshot: "off",
        trace: "off",
        video: "off",
      },
    },
  ],
});
