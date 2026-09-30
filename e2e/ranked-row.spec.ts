import { expect, test, type Page } from "@playwright/test";

import { consoleFailures, isLocalLane, watchConsole } from "./inbox";
import { seedRankedHomeSession } from "./ranked-home";

function rankedRow(page: Page, name: string) {
  return page.locator('[data-testid="standing-row"]', { hasText: name });
}

test.skip(
  !isLocalLane(),
  "seeds a ranked workspace in the local preview database; production reads a real ranked /app",
);

test("a ranked row expands in place and the open param survives a reload @smoke", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "in-place expansion is the desktop layout");
  const watched = watchConsole(page);

  const cookie = await seedRankedHomeSession("ranked-row");
  await page.setExtraHTTPHeaders({ cookie });

  const response = await page.goto("/app");
  expect(response?.status()).toBe(200);
  await page.evaluate(() => {
    (window as unknown as { __stay: number }).__stay = 1;
  });

  await rankedRow(page, "Kindred").locator('[data-slot="row-toggle"]').click();
  await expect(page).toHaveURL(/[?&]open=ent_kindred/);

  const row = rankedRow(page, "Kindred");
  await expect(row).toHaveAttribute("data-open", "true");
  const evidence = row.locator('[data-slot="row-evidence"]');
  await expect(evidence).toBeVisible();
  await expect(evidence.getByRole("tab", { name: "Site changes 2" })).toBeVisible();
  await expect(evidence.getByRole("tab", { name: "Mentions 1" })).toBeVisible();
  await expect(evidence.getByRole("tab", { name: "Ads 0" })).toBeVisible();
  await expect(evidence.getByRole("tab", { name: "Hiring 0" })).toBeVisible();

  const stayed = await page.evaluate(() => (window as unknown as { __stay: number }).__stay);
  expect(stayed).toBe(1);

  await page.reload();
  await expect(page.locator('[data-slot="row-evidence"]')).toBeVisible();

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});

test("below 860px an open ranked row's evidence is a bottom sheet that clears the param @smoke", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "phone-390", "the sheet is the phone layout");
  const watched = watchConsole(page);

  const cookie = await seedRankedHomeSession("ranked-row");
  await page.setExtraHTTPHeaders({ cookie });

  await page.goto("/app");
  await rankedRow(page, "Kindred").locator('[data-slot="row-toggle"]').click();
  await expect(page).toHaveURL(/[?&]open=ent_kindred/);

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator('[data-slot="row-evidence"]')).toBeHidden();

  await page.addStyleTag({ content: "html, body { overflow-x: visible !important; }" });
  const m = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(m.scrollWidth, JSON.stringify(m)).toBe(m.clientWidth);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page).not.toHaveURL(/[?&]open=/);

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});

test("a zero-signal row shows a dash and the self row's switch reads you @smoke", async ({ page }, testInfo) => {
  const watched = watchConsole(page);

  const cookie = await seedRankedHomeSession("ranked-row");
  await page.setExtraHTTPHeaders({ cookie });

  await page.goto("/app");
  await expect(rankedRow(page, "Casetta")).toContainText("—");
  await expect(
    page.locator('[data-testid="standing-row"][data-self="true"] [data-slot="brand-switch"]'),
  ).toHaveAttribute("data-state", "you");

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});

test("a row's source pills read live, degraded and none for the same week @smoke", async ({ page }, testInfo) => {
  const watched = watchConsole(page);

  const cookie = await seedRankedHomeSession("ranked-row");
  await page.setExtraHTTPHeaders({ cookie });

  await page.goto("/app");
  const pills = rankedRow(page, "Kindred").locator('[data-slot="row-pills"] li');
  // Kindred answered two site checks and one mention, Hacker News did not
  // answer at all, and YouTube produced nothing this week — the three pill
  // states one row can carry, asserted on the route that draws them.
  await expect(pills.filter({ hasText: "Your site checks source · 2" })).toHaveAttribute("data-state", "live");
  await expect(pills.filter({ hasText: "News mentions · 1" })).toHaveAttribute("data-state", "live");
  await expect(pills.filter({ hasText: "Hacker News mentions" })).toHaveAttribute("data-state", "degraded");
  await expect(pills.filter({ hasText: "YouTube mentions — none" })).toHaveAttribute("data-state", "none");

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
