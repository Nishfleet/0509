import { expect, test } from "@playwright/test";

/**
 * Regression for live https://0509.io/ throwing "Minified React error #418"
 * (SSR/client text hydration mismatch) on every mobile load. Root cause:
 * proofTimeLabel() in app/routes/marketing.tsx rendered time-of-day strings
 * with the visitor's timezone while SSR rendered UTC. This spec must FAIL
 * against the pre-fix bundle and PASS once timeZone: "UTC" is pinned.
 */
test.use({
  viewport: { width: 360, height: 844 },
  isMobile: true,
  hasTouch: true,
  // UTC+14, no DST: maximally divergent from the Worker's UTC clock, so the
  // pre-fix client renders a different hour string than SSR and #418 fires.
  timezoneId: "Pacific/Kiritimati",
});

test("homepage hydrates with zero React #418 page errors at 360x844", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  expect(response?.status(), "homepage must return HTTP 200").toBe(200);
  expect(
    pageErrors,
    `expected zero page errors, got: ${pageErrors.join(" | ")}`,
  ).toEqual([]);
});
