import { expect, test } from "@playwright/test";

import { SITEMAP_PATHS } from "../app/lib/public-routes";

// The /robots.txt contract (0509#4398). The body is generated from the
// public-route manifest in app/lib/public-routes.ts; what is asserted is the
// contract — the disallow rows and the sitemap line — never the full file
// verbatim.

test("GET /robots.txt serves the manifest-generated file @smoke", async ({ request }) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^text\/plain/);

  const body = await response.text();
  expect(body).toContain("Disallow: /app");
  expect(body).toContain("Allow: /mcp");
  expect(body).toContain("Allow: /api/v1/openapi.json");
  expect(body).toMatch(/^Sitemap: https?:\/\/\S+\/sitemap\.xml$/m);
});

test("GET /sitemap.xml serves the manifest-generated urlset @smoke", async ({ request }) => {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^application\/xml/);

  const body = await response.text();
  expect(body).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  // wrangler dev serves the configured route (0509.io), so the origin in the
  // body is the worker's, never the one the suite dialled. Read it from the
  // body and check every member is on that one origin, as the loader builds
  // them all from one request origin.
  const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc]) => loc);
  const origins = new Set(locs.map((loc) => new URL(loc).origin));
  expect([...origins], "the sitemap mixes origins").toHaveLength(1);
  expect(locs, "sitemap row count differs from SITEMAP_PATHS").toHaveLength(SITEMAP_PATHS.length);
  for (const path of SITEMAP_PATHS) {
    expect(locs, `the sitemap does not name the public page ${path}`).toContain(`${[...origins][0]}${path}`);
  }
  // The sitemap is published from https://0509.io. A local preview serves the
  // configured route as http://0509.io, so the absolute https:// form is
  // asserted exactly when the suite runs against the production origin.
  if (process.env.PLAYWRIGHT_TEST_BASE_URL === "https://0509.io") {
    expect(locs).toContain("https://0509.io/llms.txt");
  }
});

test("every sitemap url is served as an indexable 200, not noindex", async ({ baseURL, playwright, request }) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)];
  expect(locs.length, "sitemap row count differs from SITEMAP_PATHS").toBe(SITEMAP_PATHS.length);
  // A request context built from the config's own baseURL carries no session:
  // it is the crawler that reaches /privacy and /llms.txt with no cookie, and
  // the production run's `request` fixture is not (it presents the Access
  // service token), so this is the only fixture that can see the gate.
  const anonymous = await playwright.request.newContext({ baseURL });
  await Promise.all(
    locs.map(async (loc) => {
      const path = new URL(loc[1]).pathname;
      const response = await anonymous.get(path);
      expect(response.status(), `${path} is not a 200 for a stranger`).toBe(200);
      expect((response.headers()["x-robots-tag"] ?? "").toLowerCase(), `${path} is noindex by header`).not.toContain(
        "noindex",
      );
      const robotsMetas = ((await response.text()).match(/<meta\b[^>]*>/gi) ?? []).filter((tag) =>
        /\bname\s*=\s*["']robots["']/i.test(tag),
      );
      for (const tag of robotsMetas) {
        expect(tag.toLowerCase(), `${path} is noindex in its robots meta`).not.toContain("noindex");
      }
    }),
  );
  await anonymous.dispose();
});

test("GET /llms.txt serves the manifest-generated summary @smoke", async ({ request }) => {
  const response = await request.get("/llms.txt");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^text\/plain/);

  const body = await response.text();
  expect(body).toMatch(/^# \S/);
  expect(body).toMatch(/^> \S/m);
  expect(body).toMatch(/^- \[[^\]]+\]\(https?:\/\/[^)]+\/privacy\): \S/m);
});

test("the sitemap leaves out the noindex rebuild notice at / @smoke", async ({ request }) => {
  const body = await (await request.get("/sitemap.xml")).text();
  expect(body).not.toMatch(/<loc>https?:\/\/[^<]+\/<\/loc>/);
});

test("both legal routes carry the one robots policy @smoke", async ({ page }) => {
  for (const path of ["/privacy", "/terms"]) {
    await page.goto(path);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
  }
});

test("GET /.well-known/security.txt names a contact, an expiry and its canonical URL @smoke", async ({ request }) => {
  const response = await request.get("/.well-known/security.txt");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^text\/plain/);

  const body = await response.text();
  expect(body).toMatch(/^Contact: mailto:\S+@\S+$/m);
  expect(body).toMatch(/^Canonical: https:\/\/0509\.io\/\.well-known\/security\.txt$/m);
  const expires = /^Expires: (\S+)$/m.exec(body)?.[1] ?? "";
  expect(new Date(expires).getTime(), "security.txt has expired").toBeGreaterThan(Date.now());
});

test("www.0509.io redirects to the apex with the path and query kept (0509#4498)", async ({ playwright }) => {
  test.skip(!process.env.PLAYWRIGHT_TEST_BASE_URL, "the www host only exists in production");
  const request = await playwright.request.newContext({ maxRedirects: 0 });
  const response = await request.get("https://www.0509.io/privacy?utm_source=check");
  expect(response.status()).toBe(308);
  expect(response.headers()["location"]).toBe("https://0509.io/privacy?utm_source=check");
  await request.dispose();
});
