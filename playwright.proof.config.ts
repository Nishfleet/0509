import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "proof",
      testMatch: /proof-4062-.*\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, storageState: "e2e/.auth/access.json" },
    },
  ],
});
