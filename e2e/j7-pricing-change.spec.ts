import { expect, test, type APIRequestContext } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

// J7 part 1 from docs/REBUILD-DONE.md §A: once a fixture price flip has been
// through a completed daily competitor sweep, Alerts shows the change as a
// before-and-after mark with both screenshots, the fixture URL and a
// captured-at time after the flip.
//
// The daily sweep cannot be waited for inside one e2e run, so the fixture
// Worker carries the flip between runs: #price[data-variant][data-flipped-at]
// on the fixture is the last flip. A run either asserts a flip the sweep has
// already caught, or flips the price for the next tick and skips honestly. The
// spec never seeds D1 and never forces a sweep.
//
// Production only: the preview Worker has no sweep, no fixture Worker and no
// mail path, so the lane skips rather than fake the journey.
const FIXTURE = "https://fixture.0509.in/";
const J7_EMAIL = "e2e+j7@0509.io";
const SWEEP_HOUR_UTC = 3;
const SETTLE_MS = 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "J7 needs the production sweep, the fixture Worker and the mail path",
);

// A missing secret is a wiring fault, never a reason to skip: name it and stop.
function requireFixtureToken(): string {
  const token = process.env.FIXTURE_SITE_TOKEN;
  if (!token) {
    throw new Error(
      "FIXTURE_SITE_TOKEN is empty: the repo secret is not wired into the e2e-production job env in .github/workflows/ci.yml",
    );
  }
  return token;
}

// The latest 03:00 UTC tick a competitor sweep has finished by. The tick has to
// be at least SETTLE_MS old, and only a tick later than the flip can have seen
// that flip, so the caller compares the two.
function lastCompletedTick(now: Date): Date {
  const settled = now.getTime() - SETTLE_MS;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), SWEEP_HOUR_UTC);
  return new Date(today <= settled ? today : today - DAY_MS);
}

async function flipPrice(
  request: APIRequestContext,
  token: string,
  variant: "base" | "raised",
): Promise<void> {
  const response = await request.post(`${FIXTURE}__price?variant=${variant}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status(), `fixture.0509.in refused the ${variant} flip with HTTP ${response.status()}`).toBe(200);
}

test("a fixture price change reaches Alerts as a before-and-after mark", async ({ page, request }, testInfo) => {
  const token = requireFixtureToken();

  const fixture = await request.get(FIXTURE);
  expect(fixture.status(), `fixture.0509.in answered HTTP ${fixture.status()}`).toBe(200);
  const html = await fixture.text();
  const price = /<p id="price" data-variant="(base|raised)" data-flipped-at="([^"]*)"/.exec(html);
  if (price === null) {
    throw new Error("fixture.0509.in has no #price marker: the fixture Worker from 0509#4477 is not deployed");
  }
  const variant = price[1];
  const flippedAt = price[2];

  // Never flipped: the phone project (second on the one CI worker) starts the
  // cadence, and this run has nothing to assert yet.
  if (flippedAt === "") {
    if (testInfo.project.name === "phone-390") await flipPrice(request, token, "raised");
    test.skip(true, `J7: awaiting the first competitor sweep after the flip at ${flippedAt}`);
  }

  // The flip is newer than the last settled 03:00 UTC tick, so no sweep has
  // seen it yet. The next run after 03:00 UTC + SETTLE_MS asserts it.
  if (Date.parse(flippedAt) >= lastCompletedTick(new Date()).getTime()) {
    test.skip(true, `J7: awaiting the first competitor sweep after the flip at ${flippedAt}`);
  }

  await signInWithMagicLink(page, J7_EMAIL, requireInboxToken());
  await page.goto("/app/alerts");

  const mark = page
    .locator("article, li, section")
    .filter({ has: page.locator('a[href^="https://fixture.0509.in"]') })
    .filter({ has: page.locator('[data-slot="capture-plate"]') })
    .first();
  await expect(
    mark,
    `no fixture mark in Alerts for the flip at ${flippedAt}: is fixture.0509.in tracked by ${J7_EMAIL}'s workspace?`,
  ).toBeVisible();

  const source = mark.locator('a[href^="https://fixture.0509.in"]').first();
  await expect(source).toHaveText("https://fixture.0509.in/");

  const capturedAt = await mark.locator("figure figcaption time[dateTime]").first().getAttribute("dateTime");
  if (capturedAt === null) {
    throw new Error(`the fixture mark for the flip at ${flippedAt} carries no captured-at time`);
  }
  const capturedMs = Date.parse(capturedAt);
  expect(Number.isNaN(capturedMs), `the fixture mark's captured-at ${capturedAt} is not a date`).toBe(false);
  expect(
    capturedMs,
    `the fixture mark was captured at ${capturedAt}, which is not after the flip at ${flippedAt}`,
  ).toBeGreaterThan(Date.parse(flippedAt));

  // Both screenshots live in the capture-pair sheet the plate opens, captioned
  // Before and After with their own capture times.
  await mark.locator('[data-slot="capture-plate"]').click();
  const pair = page.locator('[data-slot="capture-pair"]');
  await expect(pair).toBeVisible();
  const figures = pair.locator("figure");
  await expect(figures).toHaveCount(2);
  await expect(figures.nth(0)).toContainText("Before");
  await expect(figures.nth(1)).toContainText("After");
  await expect
    .poll(() =>
      figures
        .locator("img")
        .evaluateAll((images) => images.map((image) => (image as HTMLImageElement).naturalWidth > 0)),
    )
    .toEqual([true, true]);
  await page.keyboard.press("Escape");
  await expect(pair).toBeHidden();

  await expect(mark).not.toContainText("Screenshot unavailable");
  await expect(mark).not.toContainText("No screenshot of the earlier version");
  await expect(mark.getByRole("heading", { level: 3 })).not.toHaveText(/^Possibly: /);
  await expect(mark).not.toContainText(/p=|\b0\.\d+/);

  await testInfo.attach("j7-mark", {
    body: JSON.stringify(
      { sourceUrl: "https://fixture.0509.in/", capturedAt, flippedAt, variant, project: testInfo.project.name },
      null,
      2,
    ),
    contentType: "application/json",
  });

  // The next tick needs the other variant, so the flip alternates base <-> raised.
  if (testInfo.project.name === "phone-390") {
    await flipPrice(request, token, variant === "raised" ? "base" : "raised");
  }
});
