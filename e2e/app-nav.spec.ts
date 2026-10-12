import { expect, test } from "@playwright/test";

import { onboardedStatePath } from "../playwright.config";
import { consoleFailures, isLocalLane, run, seedPreviewSession, watchConsole } from "./inbox";

// Production reads the onboarded storageState; the preview lane has none, so
// the beforeEach below signs in with a seeded session.
test.use({
  storageState: async ({}, use, testInfo) => {
    await use(
      process.env.PLAYWRIGHT_TEST_BASE_URL
        ? onboardedStatePath(testInfo.project.name === "phone-390" ? "phone" : "desktop")
        : undefined,
    );
  },
});

// The signed-in nav walk. Production uses the already-onboarded session that
// `e2e/onboarded.setup.ts` mints per lane; the preview lane signs in with a
// seeded session (`seedPreviewSession`), so every PR walks the nav too.
test.beforeEach(async ({ page, baseURL }) => {
  if (!isLocalLane()) return;
  const { cookie } = await seedPreviewSession("nav", ({ db, suffix, userId }) => {
    const stamp = "2026-10-12T00:00:00.000Z";
    run(
      db,
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
      `ws-${suffix}`,
      "Nav Preview",
      userId,
      stamp,
    );
    run(
      db,
      "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'self', ?, 'Nav Brand', ?)",
      `ent-self-${suffix}`,
      `ws-${suffix}`,
      `nav-${suffix}.example`,
      stamp,
    );
  });
  await page.context().addCookies(
    cookie.split("; ").map((pair) => {
      const [name, ...value] = pair.split("=");
      return { name, value: value.join("="), url: baseURL ?? "" };
    }),
  );
});

test("a signed-in user reaches the four places by tapping and by Tab+Enter", async ({ page }, testInfo) => {
  // Production lane: the nav walk overruns the 30 s
  // default (0509#5681).
  test.setTimeout(120_000);
  const watched = watchConsole(page);

  const nav = page.getByRole("navigation", { name: "Primary" });
  const noOverflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  // Tapping: start at Competitors by URL, then walk the nav by click, and end
  // on Home.
  await page.goto("/app/competitors");
  // level 1 only: "Possible competitors" is also a heading and a substring match
  // fails the walk whenever that block is on the page (0509#6912).
  await expect(page.getByRole("heading", { level: 1, name: "Competitors", exact: true })).toBeVisible();
  expect(await noOverflow()).toBe(0);
  await page.screenshot({ path: test.info().outputPath("competitors.png") });

  for (const [place, path] of [
    ["Alerts", "/app/alerts"],
    ["Settings", "/app/settings"],
  ] as const) {
    await nav.getByRole("link", { name: place }).click();
    await page.waitForURL(new RegExp(path + "$"));
    await expect(page.getByRole("heading", { level: 1, name: place, exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: place })).toHaveAttribute("aria-current", "page");
    expect(await noOverflow()).toBe(0);
    await page.screenshot({ path: test.info().outputPath(`${place.toLowerCase()}.png`) });
  }

  await nav.getByRole("link", { name: "Competitors" }).click();
  await page.waitForURL(/\/app\/competitors$/);
  await nav.getByRole("link", { name: "Home" }).click();
  await page.waitForURL(/\/app$/);

  // Keyboard: a fresh page load before tabbing pins the count from the top of
  // the document — the skip link is first, then the four Places, so
  // Home = 2 Tabs, Competitors = 3, Alerts = 4, Settings = 5.
  for (const [, path, tabs] of [
    ["Competitors", "/app/competitors", 3],
    ["Alerts", "/app/alerts", 4],
    ["Settings", "/app/settings", 5],
  ] as const) {
    await page.goto("/app/alerts");
    for (let index = 0; index < tabs; index += 1) {
      await page.keyboard.press("Tab");
    }
    const focused = page.locator(":focus");
    await expect(focused).toHaveAttribute("href", path);
    await expect(focused).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Enter");
    await page.waitForURL(new RegExp(path + "$"));
  }

  await page.goto("/app/alerts");
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveAttribute("href", "#app-content");
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveAttribute("href", "/app");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/app$/);

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
