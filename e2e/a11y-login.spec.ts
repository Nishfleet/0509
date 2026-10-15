import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./test";

import { deleteCreatedAccount, settleSignInWidget } from "./inbox";

let createdEmail = "";
test.afterEach(async ({ page }, testInfo) => {
  if (createdEmail === "") return;
  testInfo.setTimeout(testInfo.timeout + 60_000);
  await page.clock.resume();

  try {
    await deleteCreatedAccount(page, createdEmail);
  } finally {
    createdEmail = "";
  }
});

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

for (const scheme of ["light", "dark"] as const) {
  test(`/login form has zero WCAG 2.2 AA violations in ${scheme} (#4148) @smoke`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/login");

    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    await test.info().attach(`axe-login-form-${scheme}`, {
      body: JSON.stringify(results.violations, null, 2),
      contentType: "application/json",
    });
    expect(results.violations).toEqual([]);
  });

  test(`/login sent state has zero WCAG 2.2 AA violations in ${scheme} (#4148) @own-signin`, async ({ page }) => {
    await page.clock.install();
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/login");

    const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
    createdEmail = email;
    await page.locator('input[name="email"]').fill(email);
    await settleSignInWidget(page);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole("heading", { level: 1, name: "Check your email" })).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    await test.info().attach(`axe-login-sent-${scheme}`, {
      body: JSON.stringify(results.violations, null, 2),
      contentType: "application/json",
    });
    expect(results.violations).toEqual([]);
  });
}

test("the wordmark home link is a 44px tap target on /login (#6531) @smoke", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "this spec sets 1440 and 390 itself");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/login");

    const box = await page.getByRole("link", { name: "Five to Nine" }).boundingBox();
    if (box === null) throw new Error(`the wordmark link has no box at ${String(width)}px`);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});
