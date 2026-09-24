import { expect, test } from "@playwright/test";

test("the share picture sends a signed-out visitor to the login page", async ({ request }) => {
  const response = await request.get("/app/share.png", { maxRedirects: 0 });
  expect(response.status()).toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);
  expect(response.headers()["location"]).toMatch(/\/login/);
  expect(response.headers()["content-type"] ?? "").not.toContain("image/png");
});
