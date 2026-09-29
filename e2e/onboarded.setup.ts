import { writeFileSync } from "node:fs";

import { expect, test as setup, type Page } from "@playwright/test";

import { accessStatePath, onboardedEmailPath, onboardedStatePath } from "../playwright.config";
import { requireInboxToken, signInWithMagicLink } from "./inbox";

// This setup mints one onboarded session per viewport lane (desktop + phone).
// It exists because the parent issue (#6026) identifies a repeated magic-link
// sign-in plus full J3 onboarding that two specs burn to reach a watched
// competitor page. One shared session per lane replaces both.
// Fresh random addresses per run (e2e+onboarded-<lane>-<12 hex>@0509.io) ensure
// sharded runs (#6025) never share an inbox slot.
// Switch ownership: competitor-page.spec.ts owns the nike.com switch; the
// reduced-motion.spec.ts toggle test owns the adidas.com switch; every other
// consumer only reads.

const LANES = ["desktop", "phone"] as const;

setup.setTimeout(480_000);

async function addCompetitor(page: Page, domain: string): Promise<void> {
  await page.locator("#add-competitor").fill(domain);
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("switch", { name: `${domain} tracking` })).toBeChecked();
}

setup("mint one onboarded session per viewport lane", async ({ browser }) => {
  const token = requireInboxToken();
  for (const lane of LANES) {
    const context = await browser.newContext({ storageState: accessStatePath });
    const page = await context.newPage();
    try {
      const email = `e2e+onboarded-${lane}-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
      await signInWithMagicLink(page, email, token);

      // The magic link's verify creates the user row, so the account exists
      // before the onboarding drive below runs. Recording what the teardown
      // needs here means a drive that fails mid-way still leaves a deletable
      // account instead of a row nobody can find (#5733).
      await context.storageState({ path: onboardedStatePath(lane) });
      writeFileSync(onboardedEmailPath(lane), email);

      await page.goto("/onboarding");
      const input = page.getByRole("textbox", { name: "your website, or a handle" });
      await input.fill("gymshark.com");
      await input.press("Enter");

      await expect(page.getByRole("button", { name: "edit name" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("looking on the site")).toHaveCount(0, { timeout: 30_000 });
      await page.getByRole("button", { name: "That's me" }).click();
      await expect(page).toHaveURL(/\/onboarding\/competitors$/, { timeout: 30_000 });

      const watching = page.getByRole("list", { name: "Watching" }).getByRole("listitem");
      await expect(
        watching.first().or(page.getByRole("button", { name: /^Watch / }).first()),
      ).toBeVisible({ timeout: 60_000 });
      if ((await watching.count()) === 0) {
        await page.getByRole("button", { name: /^Watch / }).first().click();
        await expect(watching.first()).toBeVisible();
      }
      await page.getByRole("button", { name: "Start watching" }).click();
      await expect(page).toHaveURL(/\/app$/);

      await page.goto("/app/competitors");
      await addCompetitor(page, "nike.com");
      await addCompetitor(page, "adidas.com");

      // The fully onboarded session replaces the sign-in-only one recorded above.
      await context.storageState({ path: onboardedStatePath(lane) });
    } finally {
      await context.close();
    }
  }
});