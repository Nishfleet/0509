import { expect, test, type Page } from "@playwright/test";

import { onboardedStatePath } from "../playwright.config";
import { consoleFailures, watchConsole } from "./inbox";

// Filter vocabulary is the feed's own (app/lib/developments.ts FEED_FILTERS);
// the counts are live and asserted only as numerals — a just-watched
// competitor's rows are whatever the nightly sweeps have already stored.
const FILTERS = [
  { label: "All", kind: null },
  { label: "Ads", kind: "ad" },
  { label: "Site changes", kind: "change" },
  { label: "Mentions", kind: "mention" },
  { label: "Hiring", kind: "hiring" },
] as const;

function chip(page: Page, label: string) {
  return page.locator("[data-slot='toggle-group-item']").filter({ hasText: label });
}

function list(page: Page) {
  return page.locator("[data-slot='developments-list']");
}

// The feed test against the real detail page, production only: the preview
// Worker cannot mint a session, so this file skips there. The signed-in one
// comes from onboarded.setup.ts — a real /app/competitors/:entityId page is
// already watched in the shared session before this test opens it.
test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "the developments feed needs a real session; the local preview Worker cannot mint one",
);

test.use({
  storageState: async ({}, use, testInfo) => {
    await use(onboardedStatePath(testInfo.project.name === "phone-390" ? "phone" : "desktop"));
  },
});

test("the developments feed filters by kind and keeps its layout across filters @own-signin", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const watched = watchConsole(page);

  // Read-only test: any watched competitor serves, so it opens the first row.
  await page.goto("/app/competitors");
  await page.getByRole("list", { name: "Competitors" }).getByRole("link").first().click();
  await expect(page).toHaveURL(/\/app\/competitors\/[^/]+$/);

  // The frame renders the feed only when the competitor has developments; a
  // fresh watch usually has none, and then the assertions that matter are the
  // developmentsEmpty sentence instead (app/components/competitor-frame.tsx).
  if ((await list(page).count()) > 0) {
    await expect(page.locator("[data-slot='developments-feed']")).toBeVisible();

    for (const filter of FILTERS) {
      await expect(chip(page, filter.label)).toContainText(filter.label);
      await expect(chip(page, filter.label).locator("span")).toHaveText(/^\d+$/);
    }

    const allBox = await list(page).boundingBox();
    expect(allBox).not.toBeNull();
    await expect(list(page).locator(":scope > li").first()).toBeVisible();

    for (const filter of FILTERS) {
      await chip(page, filter.label).click();
      if (filter.kind !== null) {
        await expect(page).toHaveURL(new RegExp(`[?&]kind=${filter.kind}`));
        // Every rendered row is of the chosen kind; a kind with no live rows
        // shows the feed's own empty li, which carries no data-kind.
        await expect(list(page).locator(`:scope > li[data-kind]:not([data-kind='${filter.kind}'])`)).toHaveCount(0);
      }
      const filteredBox = await list(page).boundingBox();
      expect(filteredBox?.x).toBe(allBox?.x);
      expect(filteredBox?.width).toBe(allBox?.width);
    }

    await page.reload();
    await expect(page).toHaveURL(/[?&]kind=hiring/);
    await expect(list(page).locator(":scope > li").first()).toBeVisible();
    await expect(list(page).locator(":scope > li[data-kind]:not([data-kind='hiring'])")).toHaveCount(0);
  } else {
    await expect(
      page.getByText(/Watching from today\.|No changes to the homepage since we started watching\./),
    ).toBeVisible();
  }

  const widths = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(widths.scrollWidth).toBeLessThanOrEqual(widths.innerWidth);

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
