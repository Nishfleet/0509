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
// Diagnostic engine matrix (firefox/webkit/mobile) is not the release gate.
// On the hardened vps-verify runner, Journey 1 desktop under mobile-safari
// regularly needs ~31–33s (run 31236680609: mobile 25.9s pass, tablet 29.5s
// pass, desktop 31.6s fail ×3). The previous retries:2 fix only recovered
// intermittent single-timeout flakes when median stayed under 30s; once the
// slow path is systematically over budget, every attempt fails. Give the
// diagnostic engines 60s so first-attempt proof can complete. Chromium
// local-release stays on the global 30s timeout with retries: 0.
const diagnosticEngineProject = {
  testMatch: journeyReleaseMatch,
  timeout: 60_000,
  retries: 2,
  workers: 1,
} as const;

export default defineConfig({
  testDir: "./e2e",
  outputDir,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // The release-manifest reporter is appended by the proof runner via
  // Playwright 1.63's --add-reporter (issue #1727) instead of overriding the
  // configured reporters here.
  reporter: strictReleaseProof
    ? [["list"]]
    : process.env.CI
      ? [["dot"], ["html", { open: "never" }]]
      : "list",
  timeout: 30_000,
  use: {
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    screenshot: "only-on-failure",
    // Playwright 1.63: ARIA snapshots land in the trace alongside the DOM
    // snapshot, so the trace viewer's Display Aria mode can show the aria tree
    // side-by-side with the DOM. dom stays on (the default timeline preview);
    // aria is the new capture. screen snapshots are intentionally OFF: the
    // trace recorder's screen capture calls page.screenshot() during action
    // before/after phases, which triggers Playwright's caret-hiding
    // (inPagePrepareForScreenshots sets caret-color:transparent as an inline
    // style on every input/textarea/[contenteditable]). When that injection
    // lands before React hydration completes, the client-rendered tree carries
    // style attributes the server HTML did not, and the strict hydration bridge
    // (e2e/helpers/release-test.ts) flags it as browser_hydration_error:console
    // — turning every release proof red (issue #1752 / FleetMainRed #1774).
    // Failure screenshots (screenshot: "only-on-failure") and video
    // (retain-on-failure) are unaffected and still capture after hydration
    // settles.
    trace: {
      mode: "retain-on-failure",
      snapshots: { dom: true, aria: true },
    },
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
      name: "search-landing-page-capture",
      testDir: "./tests/e2e",
      testMatch: /search-landing-page-capture\.spec\.ts/,
      timeout: 60_000,
      use: {
        ...devices["Desktop Chrome"],
      },
    },
    {
      // BET 2 (issue 1482): the streaming three-tier e2e — runs the Vitest
      // regression test as a subprocess and asserts the tier-badge markup
      // contract on synthetic DOM. Same pattern as search-landing-page-capture.
      name: "search-streaming-three-tier",
      testDir: "./tests/e2e",
      testMatch: /search-streaming-three-tier\.spec\.ts/,
      timeout: 60_000,
      use: {
        ...devices["Desktop Chrome"],
      },
    },
    {
      name: "local-auth",
      // Landing-language live-proof captures ride the same local fixture
      // server and skip themselves unless their package flag is set, so
      // ordinary local-auth runs are unaffected. Listed explicitly because a
      // bl0\d+ pattern silently misses lettered ids such as bl033a.
      // `home-hero-viewport` (BET 9 / #1277) locks the first-viewport hero
      // composition on the same local fixture server.
      testMatch:
          /(local-authenticated|surface-audit|home-hero-viewport|bl030-capture|bl031-capture|bl032-capture|bl033a-capture|bl033b-capture|bl034-capture|bl037-capture|bl038-capture|bl039-capture|bl040-capture|bl041-capture|bl042-capture)\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: localBaseURL,
      },
    },
    {
      // Issue #1476 run-history proof: seeds a watchlist via the J3 replay
      // endpoint (one succeeded + one capture_failed capture), loads
      // /app/watchlists/:id as a signed-in workspace user, and asserts the
      // human reason label renders with no raw reason-code token.
      // Issue #1487 activation-first-brief spec is self-contained: it boots
      // its own isolated dev server (the shared webServer never sets
      // SIGNUP_FIRST_BRIEF_ENABLED, so the surface under test would be dark).
      name: "workspace",
      testDir: "./tests/e2e",
      testMatch: /(watchlist-run-history|activation-first-brief)\.spec\.ts/,
      timeout: 60_000,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: localBaseURL,
      },
    },
    {
      name: "local-release",
      testMatch: journeyReleaseMatch,
      // Canonical release proof per-test budget. The shared vps-verify
      // runner is saturated by other fleet/CI services (run 31798456838:
      // Journey 1 mobile 34.0s, tablet 1.5m under a 30s budget), and the
      // Aug 8 cross-browser escalation measured journeys needing 31-33s
      // even when the host was healthier. 60s gives slow-but-correct
      // journeys room to complete while the harness wall still bounds
      // hangs. retries stay 0: proof must be first-attempt.
      timeout: 60_000,
      retries: 0,
      workers: 1,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: localBaseURL,
      },
    },
    {
      name: "local-release-firefox",
      ...diagnosticEngineProject,
      use: {
        ...devices["Desktop Firefox"],
        baseURL: localBaseURL,
      },
    },
    {
      name: "local-release-webkit",
      ...diagnosticEngineProject,
      use: {
        ...devices["Desktop Safari"],
        baseURL: localBaseURL,
      },
    },
    {
      name: "local-release-mobile-safari",
      ...diagnosticEngineProject,
      use: {
        ...devices["iPhone 15"],
        baseURL: localBaseURL,
      },
    },
    {
      name: "local-release-mobile-chrome",
      ...diagnosticEngineProject,
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
      // Production API requests (request.get) inherit actionTimeout and have
      // no per-call override on the health/llms/robots probes. A freshly
      // deployed Worker can take >10s to serve its first request during
      // deploy propagation (run 33531233486: GET /llms.txt timed out at 10s
      // 16:52Z while the new version was still propagating, then auto-rolled
      // back). 30s gives the propagation window room without weakening the
      // smoke's ability to catch a real outage (a healthy 0509.io responds
      // in 1-3s, so 30s is still a tight bound for a hard hang).
      use: {
        ...devices["Desktop Chrome"],
        baseURL: productionBaseURL,
        actionTimeout: 30_000,
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
