import { expect, test } from "@playwright/test";

// Posts the login action. A local preview (no base URL, or loopback) is safe.
// Production would write a real verification row; J1 covers that send.
const baseURL = process.env.PLAYWRIGHT_TEST_BASE_URL ?? "";
const againstProduction = baseURL.length > 0 && !/^(https?:\/\/)?(127\.0\.0\.1|localhost)(:|\/|$)/.test(baseURL);
test.skip(againstProduction, "sent-state proof posts /login; production coverage is J1");

test("the sent state stays on /login and resend waits 30 seconds", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  const frozen = new Date("2026-09-22T12:00:00Z");
  await page.clock.install({ time: frozen });
  await page.clock.pauseAt(frozen);
  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);

  await expect(page.getByText("0509", { exact: true })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Email me a link" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "use a passkey instead" })).toBeEnabled();

  const column = page.locator("main > div");
  const columnWidth = await column.evaluate((el) => el.getBoundingClientRect().width);
  expect(columnWidth).toBeLessThanOrEqual(420);

  const email = "ada@example.com";
  await page.locator('input[name="email"]').fill(email);
  await page.locator('button[type="submit"]').click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('input[name="email"]')).toHaveCount(0);
  await expect(page.getByText(email, { exact: false })).toBeVisible();
  await expect(page.getByText("5 minutes")).toBeVisible();

  const resend = page.getByRole("button", { name: /send it again/i });
  const count = resend.locator("span");
  await expect(resend).toBeDisabled();
  await expect(count).toHaveText("30");

  await page.clock.runFor(29_000);
  await expect(resend).toBeDisabled();
  await expect(count).toHaveText("1");

  await page.clock.runFor(1_000);
  await expect(resend).toBeEnabled();
  await expect(count).toHaveCount(0);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});
