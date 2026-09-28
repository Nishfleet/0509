import { test as setup } from "@playwright/test";

import { accessStatePath, sessionStatePath } from "../playwright.config";
import { requireInboxToken, signInWithMagicLink } from "./inbox";

// One magic-link sign-in per production run (0509#6034): the specs that only
// need "a signed-in user" start from this storageState instead of each burning
// a send. The context starts from accessStatePath so the saved jar carries the
// CF_Authorization cookie next to the session cookie — the Access gate and the
// Turnstile pre-clearance (access-preclearance.server.ts reads the assertion
// from the cookie) keep working for every consumer. session-teardown deletes
// the account this mints.
setup.use({ storageState: accessStatePath });
// The inbox poll alone can take 120 s, over the 30 s default.
setup.setTimeout(180_000);

setup("sign in once and save the shared session", async ({ page }) => {
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  await signInWithMagicLink(page, email, requireInboxToken());
  await page.context().storageState({ path: sessionStatePath });
});
