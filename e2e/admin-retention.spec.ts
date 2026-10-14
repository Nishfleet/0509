import { expect, test } from "./test";

test("the retention page sends a signed-out visitor to the login page @smoke", async ({ request }) => {
  const response = await request.get("/app/admin/retention", { maxRedirects: 0 });
  expect(response.status()).toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);
  expect(response.headers().location).toMatch(/\/login/);
});
