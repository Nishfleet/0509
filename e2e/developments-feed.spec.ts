import { expect, test, type Page } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

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
// Worker cannot mint a session, so this test skips there. The journey is J3's
// — gymshark.com onboarded through "Start watching" — then the first watched
// chip on /app/competitors opens a real /app/competitors/:entityId page.
test("the developments feed filters by kind and keeps its layout across filters", async ({
  page,
}) => {
  test.skip(
    !process.env.PLAYWRIGHT_TEST_BASE_URL,
    "the developments feed needs a real session; the local preview Worker cannot mint one",
  );
  test.setTimeout(150_000);
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  await signInWithMagicLink(page, email, requireInboxToken());

  await page.goto("/onboarding");
  const input = page.getByRole("textbox", { name: "your website, or a handle" });
  await input.fill("gymshark.com");
  await input.press("Enter");

  await expect(page.getByRole("button", { name: "edit name" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("looking on the site")).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole("button", { name: "That's me" }).click();
  await expect(page).toHaveURL(/\/onboarding\/competitors$/, { timeout: 30_000 });

  const watching = page.getByRole("list", { name: "Watching" }).getByRole("listitem");
  await expect(
    watching.first().or(page.getByRole("button", { name: /^Watch / }).first()),
  ).toBeVisible({ timeout: 60_000 });
  if ((await watching.count()) === 0) {
    await page.getByRole("button", { name: /^Watch / }).first().click();
    await expect(watching.first()).toBeVisible();
  }
  await page.getByRole("button", { name: "Start watching" }).click();
  await expect(page).toHaveURL(/\/app$/);

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
        await expect(
          list(page).locator(`:scope > li[data-kind]:not([data-kind='${filter.kind}'])`),
        ).toHaveCount(0);
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
      page.getByText(
        /Watching from today\.|No changes to the homepage since we started watching\./,
      ),
    ).toBeVisible();
  }

  const widths = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(widths.scrollWidth).toBeLessThanOrEqual(widths.innerWidth);

  expect(consoleErrors).toEqual([]);
});
