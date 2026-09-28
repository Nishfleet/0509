import { expect, test } from "@playwright/test";

import { sessionStatePath } from "../playwright.config";
import { consoleFailures, watchConsole } from "./inbox";

// The session exists only in the production lane — the `session` project is
// gated on the same pair in playwright.config.ts, so both conditions are
// needed or the storageState read fails instead of the test skipping.
const productionLane = Boolean(process.env.PLAYWRIGHT_TEST_BASE_URL && process.env.CF_ACCESS_CLIENT_ID);
test.use({ storageState: productionLane ? sessionStatePath : undefined });

// The signed-in nav walk, production only: the session comes from the session
// setup project's shared storageState — one magic-link sign-in per run — and
// the preview Worker has no EMAIL binding and no inbox to read, so that setup
// cannot mint a session locally and this spec skips there rather than fake
// the journey. It runs in the `e2e-scheduled` production lane; the shared
// account's teardown deletes the address. A fresh address has no self entity,
// so Home (`/app`) redirects to `/onboarding`; Home is therefore the last step
// of each walk and asserts `/onboarding`, not `/app`.
test.skip(
  !productionLane,
  "the nav walk needs a real session; the local preview Worker can neither send nor receive email",
);

test("a signed-in user reaches the four places by tapping and by Tab+Enter", async ({ page }, testInfo) => {
  // Production lane: the nav walk overruns the 30 s default (0509#5681).
  test.setTimeout(120_000);
  const watched = watchConsole(page);

  const nav = page.getByRole("navigation", { name: "Places" });
  const noOverflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  // Tapping: start at Competitors by URL, then walk the nav by click, and end
  // on Home — a fresh address has no self entity, so /app lands on /onboarding.
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
  await page.waitForURL(/\/onboarding$/);

  // Keyboard: a fresh page load before tabbing pins the count from the top of
  // the document — the nav is the first focusable content in the shell, so
  // Home = 1 Tab, Competitors = 2, Alerts = 3, Settings = 4.
  for (const [, path, tabs] of [
    ["Competitors", "/app/competitors", 2],
    ["Alerts", "/app/alerts", 3],
    ["Settings", "/app/settings", 4],
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
  await expect(page.locator(":focus")).toHaveAttribute("href", "/app");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/onboarding$/);

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
