import { expect, test, type Page } from "@playwright/test";

const FILTERS = [
  { label: "All", kind: null, count: 7 },
  { label: "Ads", kind: "ad", count: 2 },
  { label: "Site changes", kind: "change", count: 2 },
  { label: "Mentions", kind: "mention", count: 1 },
  { label: "Hiring", kind: "hiring", count: 2 },
] as const;

function chip(page: Page, label: string) {
  return page.locator("[data-slot='toggle-group-item']").filter({ hasText: label });
}

function list(page: Page) {
  return page.locator("[data-slot='developments-list']");
}

function byKind(page: Page, kind: string) {
  return page.locator(`[data-slot='developments-list'] > li[data-kind='${kind}']`);
}

test("the preview developments feed filters by kind and keeps its layout across filters", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const response = await page.goto("/design/competitor");
  expect(response?.status()).toBe(200);

  await expect(page.locator("[data-slot='developments-feed']")).toBeVisible();

  for (const filter of FILTERS) {
    await expect(chip(page, filter.label)).toContainText(filter.label);
    await expect(chip(page, filter.label).locator("span")).toHaveText(String(filter.count));
  }

  const allBox = await list(page).boundingBox();
  expect(allBox).not.toBeNull();
  await expect(list(page).locator(":scope > li")).toHaveCount(7);

  for (const filter of FILTERS) {
    await chip(page, filter.label).click();
    if (filter.kind === null) {
      await expect(list(page).locator(":scope > li")).toHaveCount(7);
      await expect(byKind(page, "ad")).toHaveCount(2);
      await expect(byKind(page, "change")).toHaveCount(2);
      await expect(byKind(page, "mention")).toHaveCount(1);
      await expect(byKind(page, "hiring")).toHaveCount(2);
    } else {
      await expect(byKind(page, filter.kind)).toHaveCount(filter.count);
      await expect(list(page).locator(":scope > li")).toHaveCount(filter.count);
    }
    const filteredBox = await list(page).boundingBox();
    expect(filteredBox?.x).toBe(allBox?.x);
    expect(filteredBox?.width).toBe(allBox?.width);
  }

  await page.reload();
  await expect(page).toHaveURL(/[?&]kind=hiring/);
  await expect(byKind(page, "hiring")).toHaveCount(2);

  const widths = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(widths.scrollWidth).toBeLessThanOrEqual(widths.innerWidth);

  expect(consoleErrors).toEqual([]);
});
