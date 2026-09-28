import { expect, test } from "@playwright/test";

import { SITEMAP_PATHS } from "../app/lib/public-routes";

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

test("GET /sitemap.xml serves the manifest-generated urlset", async ({
  request,
}) => {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^application\/xml/);

  const body = await response.text();
  expect(body).toContain(
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  );
  // wrangler dev serves the configured route (0509.io), so the origin in the
  // body is the worker's, never the one the suite dialled. Read it from the
  // body and check every member is on that one origin, as the loader builds
  // them all from one request origin.
  const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc]) => loc);
  const origins = new Set(locs.map((loc) => new URL(loc).origin));
  expect([...origins], "the sitemap mixes origins").toHaveLength(1);
  expect(locs, "sitemap row count differs from SITEMAP_PATHS").toHaveLength(
    SITEMAP_PATHS.length,
  );
  for (const path of SITEMAP_PATHS) {
    expect(locs).toContain(`${[...origins][0]}${path}`);
  }
  // The sitemap is published from https://0509.io. `e2e-production` sets
  // PLAYWRIGHT_TEST_BASE_URL=https://0509.io and is the run that pins the
  // absolute form the issue asks for; local preview serves http://0509.io.
  if (process.env.PLAYWRIGHT_TEST_BASE_URL === "https://0509.io") {
    expect(locs).toContain("https://0509.io/llms.txt");
  }
});

test("every sitemap url is served as an indexable 200, not noindex", async ({
  request,
}) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)];
  expect(
    locs.length,
    "sitemap row count differs from SITEMAP_PATHS",
  ).toBe(SITEMAP_PATHS.length);
  await Promise.all(
    locs.map(async (loc) => {
      const path = new URL(loc[1]).pathname;
      const response = await request.get(path);
      expect(response.status(), `${path} is not a 200`).toBe(200);
      expect(
        (response.headers()["x-robots-tag"] ?? "").toLowerCase(),
        `${path} is noindex by header`,
      ).not.toContain("noindex");
      const robotsMetas = ((await response.text()).match(/<meta\b[^>]*>/gi) ??
        []
      ).filter((tag) => /\bname\s*=\s*["']robots["']/i.test(tag));
      for (const tag of robotsMetas) {
        expect(
          tag.toLowerCase(),
          `${path} is noindex in its robots meta`,
        ).not.toContain("noindex");
      }
    }),
  );
});

test("GET /llms.txt serves the manifest-generated summary", async ({
  request,
}) => {
  const response = await request.get("/llms.txt");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^text\/plain/);

  const body = await response.text();
  expect(body).toMatch(/^# \S/);
  expect(body).toMatch(/^> \S/m);
  expect(body).toMatch(/^- \[[^\]]+\]\(https?:\/\/[^)]+\/privacy\): \S/m);
});

test("the sitemap leaves out the noindex rebuild notice at /", async ({
  request,
}) => {
  const body = await (await request.get("/sitemap.xml")).text();
  expect(body).not.toMatch(/<loc>https?:\/\/[^<]+\/<\/loc>/);
});

test("GET /privacy serves robots index, follow", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "index, follow",
  );
});
