import { expect, test } from "./test";

import { onboardedStatePath } from "../playwright.config";
import {
  addCompetitorWhileDiscoveryIsUnavailable,
  deleteCreatedAccount,
  requireInboxToken,
  signInWithMagicLink,
} from "./inbox";

let createdEmail = "";
test.afterEach(async ({ page }, testInfo) => {
  if (createdEmail === "") return;
  testInfo.setTimeout(testInfo.timeout + 60_000);

  try {
    await deleteCreatedAccount(page, createdEmail);
  } finally {
    createdEmail = "";
  }
});

test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "J3 needs a signed-in session; the preview lane cannot read the magic-link inbox",
);

test.use({ screenshot: "on" });

for (const { width, height } of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`J3 onboards gymshark.com inside its budgets at ${width} @own-signin`, async ({ page }) => {
    test.setTimeout(180_000);
    const token = requireInboxToken();
    const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
    createdEmail = email;

    await page.setViewportSize({ width, height });
    await signInWithMagicLink(page, email, token);

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto("/onboarding");
    const input = page.getByRole("textbox", { name: /your website address or social username/i });
    await input.fill("gymshark.com");
    const started = Date.now();
    await input.press("Enter");

    const editName = page.getByRole("button", { name: "edit name" });
    await expect(editName).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("looking on the site")).toHaveCount(0, { timeout: 30_000 });
    await page.getByRole("button", { name: "That's me" }).click();
    await expect(page).toHaveURL(/\/onboarding\/competitors$/, { timeout: 10_000 });
    const cardConfirmedMs = Date.now() - started;
    test.info().annotations.push({
      type: "input-to-card-confirmed-ms",
      description: String(cardConfirmedMs),
    });
    expect(cardConfirmedMs).toBeLessThan(30_000);

    await addCompetitorWhileDiscoveryIsUnavailable(page);
    const competitorsMs = Date.now() - started;
    test.info().annotations.push({
      type: "input-to-competitors-ms",
      description: String(competitorsMs),
    });
    expect(competitorsMs).toBeLessThan(60_000);

    await page.getByRole("button", { name: "Start watching" }).click();
    await expect(page).toHaveURL(/\/onboarding\/plan$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Start your trial" })).toBeVisible();
    const planMs = Date.now() - started;
    test.info().annotations.push({
      type: "input-to-plan-step-ms",
      description: String(planMs),
    });

    expect(consoleErrors).toEqual([]);

    const noHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(noHorizontalScroll).toBe(true);

    test.info().annotations.push({ type: "domain", description: "gymshark.com" });
  });
}

test.describe("J3 Home after onboarding", () => {
  test.use({
    storageState: async ({}, use, testInfo) => {
      await use(onboardedStatePath(testInfo.project.name === "phone-390" ? "phone" : "desktop"));
    },
  });

  test("an onboarded gymshark.com workspace opens a Home that is not empty", async ({ page }) => {
    const response = await page.goto("/app");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/app$/);
    const standing = page.locator('[data-home="standing"]');
    await expect(standing).toBeVisible();
    await expect(standing.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(standing.getByText("Add a competitor to see where you stand.")).toHaveCount(0);
  });
});
