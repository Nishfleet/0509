import { existsSync } from "node:fs";

import { test as teardown } from "@playwright/test";

import { onboardedEmailPath, onboardedStatePath } from "../playwright.config";
import { deleteAccountViaRequest } from "./inbox";

// The teardown half of e2e/onboarded.setup.ts: the setup mints one onboarded
// session per lane, this deletes both accounts through the product's own
// settings path so no run leaves a user row behind. The setup writes the email
// file the moment the magic link verifies, so a missing file means no account
// exists and there is nothing to delete — existsSync, not a try/catch.

const LANES = ["desktop", "phone"] as const;

teardown("delete each onboarded account the setup minted", async ({ playwright, baseURL }) => {
  if (!baseURL) throw new Error("PLAYWRIGHT_TEST_BASE_URL resolved to no baseURL");
  const origin = new URL(baseURL).origin;
  for (const lane of LANES) {
    const statePath = onboardedStatePath(lane);
    const emailPath = onboardedEmailPath(lane);
    if (!existsSync(statePath) || !existsSync(emailPath)) continue;
    const api = await playwright.request.newContext({ storageState: statePath, baseURL });
    try {
      await deleteAccountViaRequest(api, origin);
    } finally {
      await api.dispose();
    }
  }
});
