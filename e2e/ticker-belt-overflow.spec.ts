import { expect, test } from "@playwright/test";

import { expectNoHorizontalOverflow } from "./helpers/release-experience";

/**
 * Mobile horizontal-overflow regression (issue #1860).
 *
 * The `ld-ticker-belt` marquee is `width: max-content` so it can glide
 * seamlessly, which used to inflate `documentElement.scrollWidth` by 2px on
 * 390px viewports (the design-gate metric
 * `scrollWidth === clientWidth`). The fix (issue #1486) bounds the
 * `.ld-ticker` container with `overflow: hidden` + `contain: inline-size` +
 * `max-width: 100%` so the belt clips inside the container instead of
 * widening the page.
 *
 * This spec locks the real-browser contract on every key public route at the
 * 390px mobile viewport: `documentElement.scrollWidth === clientWidth`. The
 * CSS-mechanism lock lives in `tests/design-system/mobile-overflow.test.tsx`;
 * this is the rendered proof that the mechanism holds on the actual pages.
 */

const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;

// The key public routes from the issue's product_surface. `/ads/:domain`
// uses a fixture domain; a cache-miss 301-redirects to `/search?q=<domain>`
// (issue #1282), which the overflow assertion still covers. The final URL is
// asserted so the test is honest about which page actually rendered.
const KEY_ROUTES = [
  { path: "/", name: "homepage", finalUrl: "/" },
  { path: "/search", name: "search", finalUrl: "/search" },
  {
    path: "/ads/nykaa.com",
    name: "ads brand page",
    // Either the brand page renders (fresh snapshot) or it 301s to the
    // search redirect target (cache miss, issue #1282).
    finalUrl: /^\/ads\/nykaa\.com(\?|$)|^\/search\?q=nykaa\.com/,
  },
  { path: "/pricing", name: "pricing", finalUrl: "/pricing" },
  { path: "/auth/signup", name: "signup", finalUrl: "/auth/signup" },
] as const;

for (const route of KEY_ROUTES) {
  test(`no horizontal overflow at 390px on ${route.name} (${route.path})`, async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    expect(page.viewportSize()).toEqual(MOBILE_VIEWPORT);

    await page.goto(route.path, { waitUntil: "domcontentloaded" });
    // Let the Bricolage wall and the proof strip settle so the layout matches
    // the rendered state, not a pre-font fallback.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);

    // Be honest about which page actually rendered (the ads route may 301 to
    // /search on a cache miss). Compare the path + query, not the full origin.
    const finalPath = new URL(page.url()).pathname + new URL(page.url()).search;
    expect(finalPath, `final URL on ${route.path}`).toMatch(route.finalUrl);

    // The issue metric: the document must not scroll horizontally at 390px.
    // Assert the numbers (not a collapsed boolean) so a failure reports the
    // actual scrollWidth vs clientWidth.
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      scrollWidth,
      `documentElement must not overflow horizontally on ${route.path} at 390px`,
    ).toBe(clientWidth);

    // Nested elements must not leak past the viewport either.
    await expectNoHorizontalOverflow(page);
  });
}

test("homepage ticker belt is clipped and does not inflate the document at 390px", async ({
  page,
}) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);

  const ticker = page.locator(".ld-ticker");
  await expect(ticker, "homepage ticker container is present").toHaveCount(1);
  const belt = page.locator(".ld-ticker-belt");
  await expect(belt, "homepage ticker belt is present").toHaveCount(1);
  // The marquee loop duplicates its run for a seamless animation (acceptance
  // criterion 2: content duplicates for the seamless loop).
  await expect(
    page.locator(".ld-ticker-run"),
    "homepage ticker run is duplicated for the seamless loop",
  ).toHaveCount(2);

  const { beltWidth, containerWidth, docWidth, clientWidth } = await page.evaluate(() => {
    const beltEl = document.querySelector<HTMLElement>(".ld-ticker-belt");
    const containerEl = document.querySelector<HTMLElement>(".ld-ticker");
    return {
      beltWidth: beltEl?.scrollWidth ?? 0,
      containerWidth: containerEl?.clientWidth ?? 0,
      docWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });

  // The belt is a wide marquee (wider than its clipping container)...
  expect(beltWidth, "marquee belt is wider than its container").toBeGreaterThan(containerWidth);
  // ...but the container clips it so the document does not overflow.
  expect(docWidth, "document does not overflow horizontally").toBe(clientWidth);
});
