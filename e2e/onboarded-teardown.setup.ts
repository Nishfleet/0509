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

// One test per lane, not one test that walks both: #7247's failing run needed
// 20.5s for a single production delete and then timed out at 30s while
// deleting two accounts one behind the other, so no shared budget covers the
// pair. The product's delete is synchronous by design — the redirect to
// /login?deleted only fires once the rows are gone — so the teardown allows
// the real duration instead of racing it.
for (const lane of LANES) {
  teardown(`delete the onboarded ${lane} account the setup minted`, async ({ playwright, baseURL }) => {
    // Set before the guards so the budget covers the whole test body. The
    // longest single delete this lane has logged is 20.5s (run 37580626642's
    // rerun); 120s leaves six times that, and each account now gets its own
    // budget, so a slow delete cannot spend the other lane's.
    teardown.setTimeout(120_000);
    if (!baseURL) throw new Error("PLAYWRIGHT_TEST_BASE_URL resolved to no baseURL");
    const statePath = onboardedStatePath(lane);
    const emailPath = onboardedEmailPath(lane);
    if (!existsSync(statePath) || !existsSync(emailPath)) return;
    const origin = new URL(baseURL).origin;
    const api = await playwright.request.newContext({ storageState: statePath, baseURL });
    try {
      await deleteAccountViaRequest(api, origin);
    } finally {
      await api.dispose();
    }
  });
}
