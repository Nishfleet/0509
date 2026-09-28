import { expect, test } from "@playwright/test";

function unknownToken(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

test("an unknown unsubscribe link is a 404 that says the link is not valid (0509#5761)", async ({ page }) => {
  const response = await page.goto(`/u/${unknownToken()}`);
  expect(response?.status()).toBe(404);
  expect(response?.headers()["cache-control"]).toBe("no-store");
  await expect(page.getByRole("heading", { level: 1, name: "This link is not valid" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Unsubscribe" })).toHaveCount(0);
  await expect(page.getByText("You're unsubscribed")).toHaveCount(0);
});

test("the RFC 8058 one-click POST answers 404 for an unknown token (0509#5761)", async ({ request }) => {
  const response = await request.post(`/u/${unknownToken()}`, {
    form: { "List-Unsubscribe": "One-Click" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(404);
});
