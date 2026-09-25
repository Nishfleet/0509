import { expect, test, type Page } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

// Production only, same reason as e2e/onboarding-identity.spec.ts: the preview
// lane cannot read the magic-link inbox. #4093's walk is the three screens
// forward and back, with the marker on the current step and the saved card
// still on screen 2 after "That's me".
test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "the step-bar walk needs a signed-in session; the preview lane cannot read the magic-link inbox",
);

const STEPS = ["your site", "your card", "your competitors"] as const;

async function expectStep(page: Page, step: 1 | 2 | 3): Promise<void> {
  const current = page.locator('[aria-label="Onboarding progress"] [aria-current="step"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText(`${step} ${STEPS[step - 1]}`);
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const noHorizontalScroll = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(noHorizontalScroll).toBe(true);
}

test("back from competitors returns to the saved card with the step marker", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const token = requireInboxToken();
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  const width = page.viewportSize()?.width ?? 0;

  await signInWithMagicLink(page, email, token);

  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/onboarding");
  await expectStep(page, 1);
  await expectNoHorizontalScroll(page);
  await testInfo.attach(`step-1-${width}`, { body: await page.screenshot(), contentType: "image/png" });

  const input = page.getByRole("textbox", { name: "your website, or a handle" });
  await input.fill("gymshark.com");
  await input.press("Enter");
  await expect(page).toHaveURL(/\/onboarding\/identity\?subject=gymshark\.com$/);
  await expect(page.getByRole("heading", { name: "This is you. Fix anything we got wrong." })).toBeVisible();
  await expectStep(page, 2);
  await expect(page.getByRole("button", { name: "edit name" })).toBeVisible({ timeout: 30_000 });
  await expectNoHorizontalScroll(page);
  await testInfo.attach(`step-2-${width}`, { body: await page.screenshot(), contentType: "image/png" });

  await page.goBack();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expectStep(page, 1);

  await page.goForward();
  await expect(page).toHaveURL(/\/onboarding\/identity\?subject=gymshark\.com$/);
  await expect(page.getByRole("button", { name: "edit name" })).toBeVisible({ timeout: 30_000 });

  const draftSaved = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes("/onboarding/identity") && response.ok(),
  );
  await page.getByRole("button", { name: "edit name" }).click();
  const name = page.getByRole("textbox", { name: "name" });
  await name.fill("Returned Gymshark");
  await name.press("Escape");
  await draftSaved;
  await page.getByRole("button", { name: "That's me" }).click();

  await expect(page).toHaveURL(/\/onboarding\/competitors$/);
  await expect(page.getByRole("heading", { name: "Who you're up against" })).toBeVisible();
  await expectStep(page, 3);
  await expectNoHorizontalScroll(page);
  await testInfo.attach(`step-3-${width}`, { body: await page.screenshot(), contentType: "image/png" });

  await page.goBack();
  await expect(page).toHaveURL(/\/onboarding\/identity/);
  await expect(page).not.toHaveURL(/\/app/);
  await expectStep(page, 2);
  await expect(page.getByRole("heading", { name: "This is you. Fix anything we got wrong." })).toBeVisible();
  await expect(page.getByRole("button", { name: "edit name" })).toHaveText("Returned Gymshark");
  await page.reload();
  await expect(page).toHaveURL(/\/onboarding\/identity/);
  await expect(page).not.toHaveURL(/\/app/);
  await expectStep(page, 2);
  await expect(page.getByRole("button", { name: "edit name" })).toHaveText("Returned Gymshark");
  await expectNoHorizontalScroll(page);
  await testInfo.attach(`step-2-return-${width}`, { body: await page.screenshot(), contentType: "image/png" });

  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/app$/);
  expect(consoleErrors).toEqual([]);
});
