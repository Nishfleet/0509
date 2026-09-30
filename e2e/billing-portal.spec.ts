import { expect, test } from "@playwright/test";

test("the billing page sends a signed-out visitor to the login page @smoke", async ({ request }) => {
  const response = await request.post("/app/settings/billing", { maxRedirects: 0 });
  expect(response.status()).toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);
  expect(response.headers()["location"]).toMatch(/\/login/);
});
