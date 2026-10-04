import { expect, test, type Page } from "@playwright/test";

import { FIXTURE_ACCOUNTS } from "../app/lib/fixture-accounts";
import { requireInboxToken, signInWithMagicLink } from "./inbox";

test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "the soak workspace lives in production; the preview lane has no inbox to sign in through",
);

const SELF_DOMAIN = "gymshark.com";
const COMPETITORS = ["nike.com", "adidas.com", "lululemon.com", "linear.app", "vercel.com"] as const;
const SWAPPED_OUT = "underarmour.com";

async function onboardSelf(page: Page): Promise<void> {
  await page.goto("/onboarding");
  const input = page.getByRole("textbox", { name: /your website address or social username/i });
  await input.fill(SELF_DOMAIN);
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "edit name" })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("looking on the site")).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole("button", { name: "That's me" }).click();
  await expect(page).toHaveURL(/\/onboarding\/competitors$/, { timeout: 10_000 });
  await page.getByRole("button", { name: "Start watching" }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 30_000 });
}

async function switchOffSwappedOut(page: Page): Promise<void> {
  const tracking = page.getByRole("switch", { name: `${SWAPPED_OUT} tracking` });
  if ((await tracking.count()) === 0 || !(await tracking.isChecked())) return;
  await tracking.click();
  await expect(tracking).not.toBeChecked({ timeout: 30_000 });
}

async function addCompetitors(page: Page): Promise<void> {
  await page.goto("/app/competitors");
  await switchOffSwappedOut(page);
  for (const domain of COMPETITORS) {
    const tracking = page.getByRole("switch", { name: `${domain} tracking` });
    if ((await tracking.count()) > 0) continue;
    await page.locator("#add-competitor").fill(domain);
    await page.getByRole("button", { name: "Add" }).click();
    await expect(tracking).toBeChecked({ timeout: 30_000 });
  }
}

async function trackedBrands(page: Page): Promise<number> {
  await page.goto("/app/competitors");
  const switches = page.getByRole("list", { name: "Competitors", exact: true }).getByRole("switch");
  await expect(switches.first()).toBeVisible();
  let on = 0;
  for (const tracking of await switches.all()) {
    if (await tracking.isChecked()) on += 1;
  }
  return on + 1;
}

test("soak workspace: one persistent production workspace tracks at least four brands @scheduled @own-signin", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  test.skip(testInfo.project.name === "phone-390", "one sign-in, one workspace: the desktop lane sets it up");

  await signInWithMagicLink(page, FIXTURE_ACCOUNTS.soak.email, requireInboxToken(), /\/(app|onboarding)/);
  const alreadyOnboarded = /\/app$/.test(new URL(page.url()).pathname);
  if (!alreadyOnboarded) await onboardSelf(page);
  await addCompetitors(page);

  const brands = await trackedBrands(page);
  console.log(
    `soak workspace: ${alreadyOnboarded ? "already onboarded" : "onboarded"}, ${String(brands)} brands tracked`,
  );
  expect(brands).toBeGreaterThanOrEqual(4);
});
