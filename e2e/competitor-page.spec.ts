import { expect, test } from "@playwright/test";

test("a competitor page sends a signed-out visitor to the login page", async ({ request }) => {
  const response = await request.get("/app/competitors/ent-anything", { maxRedirects: 0 });
  expect(response.status()).toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);
  expect(response.headers()["location"]).toMatch(/\/login/);
});

test("a change's screenshot is never served to a signed-out visitor", async ({ request }) => {
  for (const side of ["before", "after"]) {
    const response = await request.get(`/app/changes/sig-anything/${side}`, { maxRedirects: 0 });
    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.status()).toBeLessThan(400);
    expect(response.headers()["location"]).toMatch(/\/login/);
    expect(response.headers()["content-type"] ?? "").not.toContain("image/");
  }
});
