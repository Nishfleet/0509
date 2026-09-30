import { existsSync, readFileSync } from "node:fs";

import { test as teardown } from "@playwright/test";

import { onboardedEmailPath, onboardedStatePath } from "../playwright.config";
import { deleteCreatedAccount } from "./inbox";

// The teardown half of e2e/onboarded.setup.ts: the setup mints one onboarded
// session per lane, this deletes both accounts through the product's own
// settings path so no run leaves a user row behind. The setup writes the email
// file the moment the magic link verifies, so a missing file means no account
// exists and there is nothing to delete — existsSync, not a try/catch.

const LANES = ["desktop", "phone"] as const;

teardown("delete each onboarded account the setup minted", async ({ browser }) => {
  for (const lane of LANES) {
    const statePath = onboardedStatePath(lane);
    const emailPath = onboardedEmailPath(lane);
    if (!existsSync(statePath) || !existsSync(emailPath)) continue;
    const email = readFileSync(emailPath, "utf8").trim();
    const context = await browser.newContext({ storageState: statePath });
    const page = await context.newPage();
    try {
      await deleteCreatedAccount(page, email);
    } finally {
      await context.close();
    }
  }
});
