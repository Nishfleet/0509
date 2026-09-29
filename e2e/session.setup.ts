import { test as setup } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";
import { accessStatePath, sessionStatePath } from "../playwright.config";

setup.use({ storageState: accessStatePath });

setup("sign in once and save the shared session", async ({ page }) => {
  setup.setTimeout(180_000);
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  await signInWithMagicLink(page, email, requireInboxToken());
  await page.context().storageState({ path: sessionStatePath });
});
