import { defineConfig } from "@playwright/test";
const origin = "http://127.0.0.1:4179";
export default defineConfig({
  testMatch: /hydration-probe\.spec\.ts/,
  timeout: 90000,
  use: { baseURL: origin },
  webServer: {
    command: "cd /home/nish/workspaces/agent-worktrees/0509-pr625-f2-20260811-231105 && node scripts/e2e-prepare-local.mjs && E2E_TEST_MODE=1 E2E_PROVIDER_NETWORK_DENY=1 E2E_SEARCH_ROLLOUT_MODE=v2 AUTH_PROVIDER=better-auth BETTER_AUTH_SECRET=local-test-secret-local-test-secret-local BETTER_AUTH_URL= APP_ORIGIN= ./node_modules/.bin/react-router dev --host 127.0.0.1 --port 4179 --strictPort",
    reuseExistingServer: true,
    timeout: 120000,
    url: origin,
  },
});
