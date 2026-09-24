import { expect, test } from "@playwright/test";

function unknownToken(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

test("opening an unsubscribe link asks first and unsubscribes only on the button (0509#4593)", async ({ page }) => {
  const response = await page.goto(`/u/${unknownToken()}`);
  expect(response?.status()).toBe(200);
  expect(response?.headers()["cache-control"]).toBe("no-store");
  await expect(page.getByRole("heading", { level: 1, name: "Stop the weekly brief?" })).toBeVisible();
  await expect(page.getByText("You're unsubscribed")).toHaveCount(0);

  await page.getByRole("button", { name: "Unsubscribe" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "You're unsubscribed" })).toBeVisible();
});

test("the RFC 8058 one-click POST answers 200 for an unknown token (0509#4593)", async ({ request }) => {
  const response = await request.post(`/u/${unknownToken()}`, {
    form: { "List-Unsubscribe": "One-Click" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(200);
});
