import { expect, test } from "@playwright/test";

function unknownToken(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

test("an unknown confirm link is a 200 no-store page that asks to confirm (0509#5811)", async ({ page }) => {
  const response = await page.goto(`/v/${unknownToken()}`);
  expect(response?.status()).toBe(200);
  expect(response?.headers()["cache-control"]).toBe("no-store");
  await expect(page.getByRole("heading", { level: 1, name: "Confirm this email address?" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Email address confirmed" })).toHaveCount(0);
});

test("clicking Confirm email address reaches the confirmation page (0509#5811)", async ({ page }) => {
  await page.goto(`/v/${unknownToken()}`);
  await page.getByRole("button", { name: "Confirm email address" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Email address confirmed" })).toBeVisible();
});

test("a raw POST to /v/<unknown> answers 200 (0509#5811)", async ({ request }) => {
  const response = await request.post(`/v/${unknownToken()}`, { maxRedirects: 0 });
  expect(response.status()).toBe(200);
});
