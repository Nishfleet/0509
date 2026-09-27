import { expect, test } from "@playwright/test";

import { settleSignInWidget } from "./inbox";

// #4015, DESIGN.md §2.2: the sent state lands in place and the resend counts down for 30 s.
test("the sent state lands in place and the resend waits 30 seconds with a visible count", async ({ page }, testInfo) => {
  const consoleErrors: { text: string; url: string }[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push({ text: message.text(), url: message.location().url });
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.clock.install();

  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);

  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  await page.locator('input[name="email"]').fill(email);
  await settleSignInWidget(page);
  await page.locator('button[type="submit"]').click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('input[name="email"]')).toHaveCount(0);
  await expect(page.getByText(email)).toBeVisible();

  const resend = page.getByRole("button", { name: /send it again/i });
  await expect(resend).toBeDisabled();
  await expect(resend).toHaveText(/\d+s/);

  await page.clock.runFor(31_000);
  await expect(resend).toBeEnabled();
  await expect(resend).not.toHaveText(/\d+s/);

  const fitsViewport = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(fitsViewport).toBe(true);

  const pageOrigin = new URL(page.url()).origin;
  const failures = [
    ...consoleErrors
      .filter((entry) => !entry.url || new URL(entry.url).origin === pageOrigin)
      .map((entry) => `${entry.text} @ ${entry.url}`),
    ...pageErrors,
  ];
  expect(failures, testInfo.project.name).toEqual([]);
});
