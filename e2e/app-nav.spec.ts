import { expect, test } from "@playwright/test";

import { onboardedStatePath } from "../playwright.config";
import { consoleFailures, watchConsole } from "./inbox";

// The session comes from the `session` setup project's storageState (one
// magic-link sign-in per run). The only test here is production-only, so the
// missing local state file is never read.
test.use({
  storageState: async ({}, use, testInfo) => {
    await use(
      process.env.PLAYWRIGHT_TEST_BASE_URL
        ? onboardedStatePath(testInfo.project.name === "phone-390" ? "phone" : "desktop")
        : undefined,
    );
  },
});

// The signed-in nav walk, production only: the preview Worker has no inbox, so
// the session setup project does not exist there, and this spec skips rather
// than fake the journey. It runs in the `e2e-production` job after deploy. A
// fresh address has no self entity, so Home (`/app`) redirects to
// `/onboarding`; Home is therefore the last step of each walk and asserts
// `/onboarding`, not `/app`.
test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "the nav walk needs a real session; the local preview Worker can neither send nor receive email",
);

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
  await expect(page.getByRole("heading", { name: "Competitors" })).toBeVisible();
  expect(await noOverflow()).toBe(0);
  await page.screenshot({ path: test.info().outputPath("competitors.png") });

  for (const [place, path] of [
    ["Alerts", "/app/alerts"],
    ["Settings", "/app/settings"],
  ] as const) {
    await nav.getByRole("link", { name: place }).click();
    await page.waitForURL(new RegExp(path + "$"));
    await expect(page.getByRole("heading", { name: place })).toBeVisible();
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
