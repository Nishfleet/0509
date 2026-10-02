import { expect, test } from "@playwright/test";

import { signInWithMagicLink, requireInboxToken } from "./inbox";
import { captureIds, counts, log } from "./proof-4012-lib";

test.skip(!process.env.PLAYWRIGHT_TEST_BASE_URL, "proof for 0509#4012 runs against production only");

const COMPETITORS = ["notion.so", "asana.com", "clickup.com", "monday.com"];

test("0509#4012 rich workspace: sign in, onboard linear.app, add competitors, keep it", async ({ page }) => {
  test.setTimeout(900_000);
  const token = requireInboxToken();
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  log("email", email);
  log("startedAt", new Date().toISOString());

  await signInWithMagicLink(page, email, token);
  await page.goto("/onboarding");
  const input = page.getByRole("textbox", { name: /your website address or social username/i });
  await input.fill("linear.app");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "edit name" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("looking on the site")).toHaveCount(0, { timeout: 60_000 });
  await page.getByRole("button", { name: "That's me" }).click();
  await expect(page).toHaveURL(/\/onboarding\/competitors$/, { timeout: 20_000 });
  const watching = page.getByRole("list", { name: "Watching" }).getByRole("listitem");
  const candidate = watching
    .first()
    .or(page.getByRole("button", { name: /^Watch / }).first())
    .first();
  for (let attempt = 1; attempt <= 4; attempt++) {
    if (await candidate.isVisible({ timeout: 30_000 }).catch(() => false)) break;
    log("competitors screen not ready; reloading", { attempt });
    await page.reload();
  }
  await expect(candidate).toBeVisible({ timeout: 30_000 });
  if ((await watching.count()) === 0) {
    await page
      .getByRole("button", { name: /^Watch / })
      .first()
      .click();
    await expect(watching.first()).toBeVisible();
  }
  await page.getByRole("button", { name: "Start watching" }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 60_000 });

  await page.goto("/app/competitors");
  const list = page.getByRole("list", { name: "Competitors", exact: true });
  for (const domain of COMPETITORS) {
    const row = list.getByRole("listitem").filter({ hasText: domain });
    if ((await row.count()) === 0) {
      await page.locator("#add-competitor").fill(domain);
      await page.getByRole("button", { name: "Add" }).click();
    }
    await expect(row.getByRole("switch")).toBeChecked({ timeout: 30_000 });
    log("competitor watched", domain);
  }

  const ids = captureIds(email);
  log("RICH ACCOUNT", { email, userId: ids.userId, workspaceId: ids.workspaceId });
  log("ids", {
    entities: ids.entities.length,
    watches: ids.watches.length,
    pages: ids.pages.length,
    wsTables: ids.wsTables,
  });
  expect(ids.workspaceId).not.toBe("");
  log("COUNTS NOW", counts(ids));
  await page.goto("/app");
  await expect(page).toHaveURL(/\/app$/);
});
