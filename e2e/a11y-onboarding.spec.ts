import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

// Production only, for the reason e2e/onboarding-input.spec.ts gives: the
// preview lane's wrangler dev has no EMAIL binding and no inbox to read, so a
// spec that signs in through the real magic link skips there rather than fakes
// a session. The three tests below are the WCAG 2.2 AA proof for #4149.
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
  await expect(page.getByRole("button", { name: "That's me" })).toBeVisible({ timeout: 30_000 });

  for (const colorScheme of ["light", "dark"] as const) {
    for (const width of [1440, 390]) {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      await expect(page.getByRole("button", { name: "That's me" })).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Draw my card" })).toBeFocused();

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

test("screen 2 is operable by keyboard in order, with one polite live region (#4149)", async ({
  page,
}, testInfo) => {
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

  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/onboarding");

  const input = page.getByRole("textbox", { name: "your website, or a handle" });
  await input.fill("nike.com");
  await input.press("Enter");
  await expect(page).toHaveURL(/\/onboarding\/identity\?subject=nike\.com$/);
  await expect(page.getByRole("button", { name: "That's me" })).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByRole("button", { name: "That's me" })).toBeVisible();

  await expect(page.getByRole("status")).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.keyboard.press("Tab");
  const editName = page.getByRole("button", { name: "edit name" });
  await expect(editName).toBeFocused();
  await expect(editName).toHaveCSS("outline-style", "solid");
  await testInfo.attach("focus-edit-name", {
    body: await page.screenshot(),
    contentType: "image/png",
  });

  await page.keyboard.press("Enter");
  const nameField = page.getByRole("textbox", { name: "name", exact: true });
  await expect(nameField).toBeFocused();
  await scan("identity-editor-open-light-1440");

  await page.keyboard.press("Escape");
  await expect(editName).toBeFocused();
  await expect(nameField).toHaveCount(0);

  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(editName).toBeFocused();
  await expect(nameField).toHaveCount(0);

  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "edit about" })).toBeFocused();

  const thatsMe = page.getByRole("button", { name: "That's me" });
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.press("Tab");
    if (await thatsMe.evaluate((el) => el === document.activeElement)) break;
    expect(await page.evaluate(() => document.activeElement?.getAttribute("type"))).toBe("checkbox");
  }
  await expect(thatsMe).toBeFocused();
  await testInfo.attach("focus-thats-me", {
    body: await page.screenshot(),
    contentType: "image/png",
  });

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "support@0509.io" })).toBeFocused();
});
