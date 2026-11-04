import { expect, test as setup, type Page } from "@playwright/test";

import { FIXTURE_ACCOUNTS } from "../app/lib/fixture-accounts";
import { accessStatePath, onboardedStatePath } from "../playwright.config";
import { requireInboxToken, signInWithMagicLink } from "./inbox";

const LANES = [
  { lane: "desktop", email: FIXTURE_ACCOUNTS.onboardedDesktop.email },
  { lane: "phone", email: FIXTURE_ACCOUNTS.onboardedPhone.email },
] as const;

setup.setTimeout(480_000);

async function waitForCompetitorsPost(page: Page): Promise<void> {
  const response = await page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" && new URL(candidate.url()).pathname.startsWith("/app/competitors"),
  );
  expect(response.ok()).toBe(true);
}

async function switchOffOneOther(page: Page): Promise<void> {
  const other = page.getByRole("switch", { name: /^(?!Nike|Adidas).* tracking/, checked: true });
  const before = await other.count();
  if (before === 0) return;
  const switchedOff = waitForCompetitorsPost(page);
  await other.first().click();
  await expect(other).toHaveCount(before - 1);
  await switchedOff;
}

async function addCompetitor(page: Page, domain: string): Promise<void> {
  const row = page
    .getByRole("list", { name: "Competitors", exact: true })
    .getByRole("listitem")
    .filter({ hasText: domain });
  await expect(
    page.getByRole("list", { name: "Competitors", exact: true }).getByRole("listitem").first(),
  ).toBeVisible();
  const tracking = row.getByRole("switch");
  if ((await row.count()) > 0) {
    if (!(await tracking.isChecked())) {
      await switchOffOneOther(page);
      const switchedOn = waitForCompetitorsPost(page);
      await tracking.click();
      await switchedOn;
    }
  } else {
    await switchOffOneOther(page);
    await page.locator("#add-competitor").fill(domain);
    const added = waitForCompetitorsPost(page);
    const add = page.getByRole("button", { name: "Add", exact: true });
    await add.click();
    await added;
    await expect(add).toBeEnabled();
    await expect(page.locator("#add-competitor-error")).toHaveCount(0);
  }
  await expect(tracking).toBeChecked({ timeout: 30_000 });
}

async function confirmCard(page: Page): Promise<void> {
  const input = page.getByRole("textbox", { name: /your website address or social username/i });
  await input.fill("gymshark.com");
  await input.press("Enter");

  await expect(page.getByRole("button", { name: "edit name" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("looking on the site")).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole("button", { name: "Looks right" }).click();
  await expect(page).toHaveURL(/\/onboarding\/competitors$/, { timeout: 10_000 });
}

async function onboard(page: Page): Promise<void> {
  await page.goto("/onboarding");
  if (!new URL(page.url()).pathname.startsWith("/onboarding/competitors")) await confirmCard(page);

  const watching = page.getByRole("list", { name: "Watching" }).getByRole("listitem");
  await expect(
    watching
      .first()
      .or(page.getByRole("button", { name: /^Watch / }).first())
      .first(),
  ).toBeVisible({
    timeout: 60_000,
  });
  if ((await watching.count()) === 0) {
    await page
      .getByRole("button", { name: /^Watch / })
      .first()
      .click();
    await expect(watching.first()).toBeVisible();
  }
  await page.getByRole("button", { name: "Start watching" }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 30_000 });
}

setup("mint one onboarded session per viewport lane", async ({ browser }) => {
  const token = requireInboxToken();
  for (const { lane, email } of LANES) {
    const context = await browser.newContext({ storageState: accessStatePath });
    const page = await context.newPage();
    page.on("response", (response) => {
      const reference = response.headers()["x-error-reference"];
      if (reference !== undefined) {
        console.log(
          `error-reference ${lane} ${new URL(response.url()).pathname} ${String(response.status())} ${reference}`,
        );
      }
      const timing = response.headers()["server-timing"];
      if (timing === undefined) return;
      console.log(`server-timing ${lane} ${new URL(response.url()).pathname} ${String(response.status())} ${timing}`);
    });
    try {
      await signInWithMagicLink(page, email, token, /\/(app|onboarding)/);
      if (new URL(page.url()).pathname.startsWith("/onboarding")) await onboard(page);

      await page.goto("/app/competitors");
      await addCompetitor(page, "nike.com");
      await addCompetitor(page, "adidas.com");

      await context.storageState({ path: onboardedStatePath(lane) });
    } finally {
      await context.close();
    }
  }
});
