import { expect, test } from "@playwright/test";

// The /robots.txt contract (0509#4398). The body is generated from the
// public-route manifest in app/lib/public-routes.ts; what is asserted is the
// contract — the disallow rows and the sitemap line — never the full file
// verbatim.

test("GET /robots.txt serves the manifest-generated file", async ({
  request,
}) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^text\/plain/);

  const body = await response.text();
  expect(body).toContain("Disallow: /app");
  expect(body).toMatch(/^Sitemap: https?:\/\/\S+\/sitemap\.xml$/m);
});
