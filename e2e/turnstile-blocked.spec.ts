import { expect, test, expectNoise } from "./test";

const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

const BLOCKED_NOTICE = "We couldn't load the check that stops bots";

test("the blocked bot check tells the person on /login instead of asking them to confirm @smoke", async ({ page }) => {
  expectNoise(/turnstile\.load_failed/);

  await page.route(`${TURNSTILE_ORIGIN}/**`, (route) => route.abort());

  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);

  await page.locator("#email").focus();

  const alert = page.getByRole("alert");
  await expect(alert).toContainText(BLOCKED_NOTICE);

  await expect(alert).toContainText(/content blocker/i);
  await expect(alert).toContainText(/reload/i);

  await expect(page.locator("[data-turnstile]")).toHaveCount(1);

  await expect(page.locator('button[type="submit"]')).toBeEnabled();
});

test("the working bot check shows no failure notice on /login @smoke", async ({ page }) => {
  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);

  await page.locator("#email").focus();
  const field = page.locator('input[name="cf-turnstile-response"]');
  await expect(field).toHaveCount(1, { timeout: 30_000 });

  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator("[data-turnstile]")).toHaveCount(1);
});
