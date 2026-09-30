import { expect, test } from "@playwright/test";

test("the data export sends a signed-out visitor to the login page @smoke", async ({ request }) => {
  const response = await request.get("/app/settings/export", { maxRedirects: 0 });
  expect(response.status()).toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);
  expect(response.headers()["location"]).toMatch(/\/login/);
  expect(response.headers()["content-disposition"] ?? "").not.toContain("attachment");
});
