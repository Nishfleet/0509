import { expect, test, type Page } from "@playwright/test";

import { FIXTURE_ACCOUNTS } from "../app/lib/fixture-accounts";
import { consoleFailures, requireInboxToken, signInWithMagicLink, watchConsole } from "./inbox";

// J7 from docs/REBUILD-DONE.md §A (0509#4123): the fixture site is the tracked
// competitor, its Pro price is flipped through the token-guarded /__price
// route, and once a nightly site sweep has read the flip, Alerts shows it as a
// before-and-after mark of the right kind with both screenshots and the
// fixture URL as its source. No forced sweep and no seeded row: the spec asserts
// a flip the real 02:00 UTC sweep already caught, and otherwise flips the price
// for the next tick. The account is FIXTURE_ACCOUNTS.j7, kept between runs, so
// the state that carries the journey survives; it is never deleted.
// Production only: the preview Worker has no inbox to sign in through.
test.skip(!process.env.PLAYWRIGHT_TEST_BASE_URL, "J7 needs the production sweep, the fixture Worker and the mail path");

const FIXTURE_ORIGIN = "https://fixture.0509.in";
// The Competitors list shows the registrable domain, so the fixture row reads 0509.in.
const FIXTURE_ROW = "0509.in";
const SWEEP_UTC_HOUR = 2;
const SETTLE_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type Variant = "base" | "raised";

const OLD_AND_NEW: Record<Variant, { before: RegExp; after: RegExp }> = {
  raised: { before: /base|1,299/, after: /raised|1,499/ },
  base: { before: /raised|1,499/, after: /base|1,299/ },
};

async function readFixture(): Promise<{ variant: Variant; flippedAt: string }> {
  const response = await fetch(`${FIXTURE_ORIGIN}/`);
  expect(response.status).toBe(200);
  const html = await response.text();
  const match = /<p id="price" data-variant="(base|raised)" data-flipped-at="([^"]*)"/.exec(html);
  if (match === null) {
    throw new Error(
      "the fixture Worker serves no #price marker: 0509-fixture-site is not deployed with the J7 variant",
    );
  }
  return { variant: match[1] as Variant, flippedAt: match[2] };
}

function lastCompletedTick(now: number): number {
  const date = new Date(now);
  const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), SWEEP_UTC_HOUR);
  return today + SETTLE_MS <= now ? today : today - DAY_MS;
}

async function flip(variant: Variant): Promise<void> {
  const token = process.env.FIXTURE_SITE_TOKEN;
  if (!token) throw new Error("FIXTURE_SITE_TOKEN is not set; J7 cannot flip the fixture price");
  const response = await fetch(`${FIXTURE_ORIGIN}/__price?variant=${variant}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(200);
}

async function trackFixture(page: Page): Promise<void> {
  const input = page.getByRole("textbox", { name: /your website address or social username/i });
  await input.fill("0509.io");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "edit name" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("looking on the site")).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole("button", { name: "That's me" }).click();
  await expect(page).toHaveURL(/\/onboarding\/competitors$/, { timeout: 10_000 });
  await page.getByLabel("Add a competitor we missed").fill("fixture.0509.in");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("list", { name: "Watching" }).getByRole("listitem")).toHaveCount(1);
  await page.getByRole("button", { name: "Start watching" }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 30_000 });
}

test("J7 a fixture price flip reaches Alerts as a before-and-after mark @own-signin", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name === "phone-390",
    "one fixed account holds one inbox slot; the mark is asserted at 1440 and its 390 layout is checked at the end",
  );
  test.setTimeout(150_000);

  const { variant, flippedAt } = await readFixture();
  const caught = flippedAt !== "" && Date.parse(flippedAt) < lastCompletedTick(Date.now());
  test.skip(flippedAt !== "" && !caught, `J7: awaiting the first site sweep after the flip at ${flippedAt}`);

  const watched = watchConsole(page);
  await signInWithMagicLink(page, FIXTURE_ACCOUNTS.j7.email, requireInboxToken(), /\/(onboarding|app)/);
  if (new URL(page.url()).pathname.startsWith("/onboarding")) await trackFixture(page);

  await page.goto("/app/competitors");
  const listed = page.getByRole("list", { name: "Competitors", exact: true }).getByRole("listitem");
  expect(await listed.count(), "the j7 account holds more competitors than its journey needs").toBeLessThanOrEqual(
    FIXTURE_ACCOUNTS.j7.maxCompetitors,
  );

  if ((await listed.filter({ hasText: FIXTURE_ROW }).count()) === 0) {
    await page.getByLabel("Add a competitor we missed").fill("fixture.0509.in");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(listed.filter({ hasText: FIXTURE_ROW })).toHaveCount(1, { timeout: 60_000 });
    await flip(variant === "raised" ? "base" : "raised");
    test.skip(true, "J7: the account was not watching the fixture; added it and flipped the price for the next sweeps");
  }

  if (flippedAt === "") {
    await flip("raised");
    test.skip(flippedAt === "", "J7: flipped the fixture price to raised; the next 02:00 UTC sweep reads it");
  }

  await page.goto("/app/alerts");
  const chip = page.getByTestId("alert-chip-site-changes");
  if (await chip.isDisabled()) {
    const next: Variant = variant === "raised" ? "base" : "raised";
    await flip(next);
    test.skip(true, `J7: no sweep has filed a change yet; flipped to ${next} for the next one`);
  }
  await expect(chip).toBeEnabled();
  const mark = page
    .getByTestId("site-change")
    .filter({ has: page.locator(`a[href^="${FIXTURE_ORIGIN}"]`) })
    .filter({ has: page.locator("s", { hasText: OLD_AND_NEW[variant].before }) })
    .filter({ has: page.locator("ins", { hasText: OLD_AND_NEW[variant].after }) })
    .first();
  await expect(mark).toBeVisible();
  await expect(mark.getByRole("heading", { level: 3 })).toHaveText(/ changed its homepage$/);

  const source = await mark.locator(`a[href^="${FIXTURE_ORIGIN}"]`).first().getAttribute("href");
  const capturedAt = await mark.locator("figcaption time").first().getAttribute("datetime");
  expect(Date.parse(capturedAt ?? "")).toBeGreaterThan(Date.parse(flippedAt));

  await mark.getByRole("button", { name: /^Open before and after: / }).click();
  const pair = page.locator('[data-slot="capture-pair"]');
  await expect(pair.getByText("Before", { exact: false }).first()).toBeVisible();
  await expect(pair.getByText("After", { exact: false }).first()).toBeVisible();
  await expect(pair.locator("figure")).toHaveCount(2);
  await expect(pair.locator('[data-slot="capture-missing"]')).toHaveCount(0);
  for (const image of await pair.locator("img").all()) {
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  }
  await page.keyboard.press("Escape");

  await page.goto("/app/competitors");
  await listed.first().getByRole("link").first().click();
  const slab = page.locator("[data-section='biggest-move']");
  await expect(slab.locator("s", { hasText: OLD_AND_NEW[variant].before })).toBeVisible();
  await expect(slab.locator("ins", { hasText: OLD_AND_NEW[variant].after })).toBeVisible();
  await expect(slab.locator("[data-slot='biggest-move-read']")).toContainText(
    /\d+ × \d+ = \d+ points, the most of anything this brand did this week\./,
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(mark).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);

  console.log(`j7-mark source=${source ?? ""} capturedAt=${capturedAt ?? ""} flippedAt=${flippedAt}`);
  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);

  await flip(variant === "raised" ? "base" : "raised");
});
