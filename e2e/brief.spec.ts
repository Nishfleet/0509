import { expect, test } from "@playwright/test";

test("the brief page sends a signed-out visitor to the login page", async ({ request }) => {
  for (const path of ["/app/brief", "/app/brief/dg-missing"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.status()).toBeLessThan(400);
    expect(response.headers()["location"]).toMatch(/\/login/);
  }
});
