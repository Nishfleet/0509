import { expect, test } from "./test";

import { onboardedStatePath } from "../playwright.config";
import { consoleFailures, isLocalLane, run, seedPreviewSession, watchConsole } from "./inbox";

test.use({
  storageState: async ({}, use, testInfo) => {
    await use(
      process.env.PLAYWRIGHT_TEST_BASE_URL
        ? onboardedStatePath(testInfo.project.name === "phone-390" ? "phone" : "desktop")
        : undefined,
    );
  },
});

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

test("a signed-in user reaches the five places by tapping and by Tab+Enter", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const watched = watchConsole(page);

  const nav = page.getByRole("navigation", { name: "Primary" });
  const noOverflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  await page.goto("/app/competitors");

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

  await nav.getByRole("link", { name: "Brief" }).click();
  await page.waitForURL(/\/app\/brief$/);
  await expect(page.getByRole("heading", { level: 1, name: "Your weekly brief", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Brief" })).toHaveAttribute("aria-current", "page");
  expect(await noOverflow()).toBe(0);

  await nav.getByRole("link", { name: "Competitors" }).click();
  await page.waitForURL(/\/app\/competitors$/);
  await nav.getByRole("link", { name: "Home" }).click();
  await page.waitForURL(/\/app$/);

  for (const [, path, tabs] of [
    ["Competitors", "/app/competitors", 3],
    ["Brief", "/app/brief", 4],
    ["Alerts", "/app/alerts", 5],
    ["Settings", "/app/settings", 6],
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

test("the skip link jumps to the page content and back keeps the right place marked", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Primary" });
  await page.goto("/app/alerts");
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveAttribute("href", "#app-content");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#app-content$/);

  await nav.getByRole("link", { name: "Settings" }).click();
  await page.waitForURL(/\/app\/settings$/);
  await page.goBack();
  await page.waitForURL(/\/app\/alerts/);
  await expect(nav.getByRole("link", { name: "Alerts" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Settings" })).not.toHaveAttribute("aria-current", "page");
});
