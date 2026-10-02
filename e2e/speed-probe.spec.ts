import { test } from "@playwright/test";

import { onboardedStatePath } from "../playwright.config";

test.use({ storageState: onboardedStatePath("desktop") });

const PAGES = ["/app", "/app/competitors", "/app/alerts", "/app/brief", "/app/settings"];

test("speed probe: signed-in page timings", async ({ page }) => {
  test.setTimeout(240_000);
  const server = new Map<string, string>();
  page.on("response", (response) => {
    const timing = response.headers()["server-timing"];
    if (timing !== undefined) server.set(new URL(response.url()).pathname, timing);
    const placement = response.headers()["cf-placement"];
    const ray = response.headers()["cf-ray"];
    if (response.request().resourceType() === "document") {
      console.log(
        `PLACEMENT ${new URL(response.url()).pathname} placement=${placement ?? "none"} ray=${ray ?? "none"}`,
      );
    }
  });
  for (const path of PAGES) {
    for (let run = 1; run <= 3; run += 1) {
      server.clear();
      const started = Date.now();
      await page.goto(path, { waitUntil: "load" });
      const wall = Date.now() - started;
      const nav = await page.evaluate(() => {
        const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
        const paint = performance.getEntriesByName("first-contentful-paint")[0];
        return {
          ttfb: Math.round(entry.responseStart),
          dcl: Math.round(entry.domContentLoadedEventEnd),
          fcp: Math.round(paint?.startTime ?? -1),
          kb: Math.round(
            performance
              .getEntriesByType("resource")
              .reduce((sum, r) => sum + (r as PerformanceResourceTiming).encodedBodySize, 0) / 1024,
          ),
          requests: performance.getEntriesByType("resource").length,
        };
      });
      console.log(`SPEED ${path} run${run} wall=${wall} ${JSON.stringify(nav)} server=${server.get(path) ?? "none"}`);
    }
  }
  for (const [from, to] of [
    ["/app", "/app/competitors"],
    ["/app/competitors", "/app/alerts"],
    ["/app/alerts", "/app/settings"],
  ]) {
    await page.goto(from);
    const started = Date.now();
    await page.locator(`a[href="${to}"]`).first().click();
    await page.waitForURL(`**${to}`);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    console.log(`SPEED click ${from} -> ${to} ${Date.now() - started}ms`);
  }
});
