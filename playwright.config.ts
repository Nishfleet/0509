import { defineConfig, devices } from "@playwright/test";

const localBaseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4179";
const previewBaseURL = process.env.E2E_PREVIEW_BASE_URL ?? localBaseURL;
const productionBaseURL = process.env.E2E_PROD_BASE_URL ?? "https://0509.io";
const authState = process.env.AUTH_STATE ?? ".auth/0509-internal.json";
const shouldStartLocalServer = process.env.E2E_START_LOCAL_SERVER === "1";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["dot"], ["html", { open: "never" }]] : "list",
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
        command: "npm run e2e:serve:local",
        reuseExistingServer: false,
        timeout: 120_000,
        url: localBaseURL,
      }
    : undefined,
  projects: [
    {
      name: "local-auth",
      testMatch: /local-authenticated\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
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
