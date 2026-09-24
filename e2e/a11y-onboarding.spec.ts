import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "the onboarding screens need a signed-in session; the preview lane cannot read the magic-link inbox",
);

test("the three onboarding screens pass axe at WCAG 2.2 AA in both themes and at both widths (#4149)", async ({ page }, testInfo) => {
  const token = requireInboxToken();
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  await signInWithMagicLink(page, email, token);

  async function scan(label: string): Promise<void> {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    await testInfo.attach(label, {
      body: JSON.stringify(results.violations, null, 2),
      contentType: "application/json",
    });
    expect(results.violations).toEqual([]);
  }

  for (const colorScheme of ["light", "dark"] as const) {
    for (const width of [1440, 390]) {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/onboarding");
      await scan(`onboarding-${colorScheme}-${width}`);
    }
  }

  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/onboarding");
  const input = page.getByRole("textbox", { name: "your website, or a handle" });
  await input.fill("nike.com");
  await input.press("Enter");
  await expect(page).toHaveURL(/\/onboarding\/identity\?subject=nike\.com$/);
  await expect(page.getByRole("button", { name: "That's me" })).toBeVisible();

  for (const colorScheme of ["light", "dark"] as const) {
    for (const width of [1440, 390]) {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      await scan(`identity-${colorScheme}-${width}`);
    }
  }

  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "That's me" }).click();
  await expect(page).toHaveURL(/\/onboarding\/competitors$/);

  for (const colorScheme of ["light", "dark"] as const) {
    for (const width of [1440, 390]) {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      await scan(`competitors-${colorScheme}-${width}`);
    }
  }
});

test("screen 1 is operable by keyboard in order (#4149)", async ({ page }, testInfo) => {
  const token = requireInboxToken();
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  await signInWithMagicLink(page, email, token);

  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/onboarding");

  const input = page.getByRole("textbox", { name: "your website, or a handle" });
  await expect(input).toBeFocused();

  await page.keyboard.press("Tab");
  const passkey = page.getByRole("button", { name: "Add a passkey" });
  await expect(passkey).toBeFocused();
  await testInfo.attach("focus-passkey", {
    body: await page.screenshot(),
    contentType: "image/png",
  });

  await page.keyboard.press("Tab");
  const support = page.getByRole("link", { name: "support@0509.io" });
  await expect(support).toBeFocused();
  await testInfo.attach("focus-support", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});
