import { expect, test } from "./test";

import { onboardedStatePath } from "../playwright.config";
import { consoleFailures, watchConsole } from "./inbox";

test.use({ screenshot: { mode: "on", fullPage: true } });

test("a competitor page sends a signed-out visitor to the login page @smoke", async ({ request }) => {
  const response = await request.get("/app/competitors/ent-anything", { maxRedirects: 0 });
  expect(response.status()).toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);
  expect(response.headers().location).toMatch(/\/login/);
});

test("a change's screenshot is never served to a signed-out visitor @smoke", async ({ request }) => {
  for (const side of ["before", "after"]) {
    const response = await request.get(`/app/changes/sig-anything/${side}`, { maxRedirects: 0 });
    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.status()).toBeLessThan(400);
    expect(response.headers().location).toMatch(/\/login/);
    expect(response.headers()["content-type"] ?? "").not.toContain("image/");
  }
});

test.describe("a watched competitor page leads with the switch and its consequence, and turns off without a dialog @own-signin", () => {
  test.skip(
    !process.env.PLAYWRIGHT_TEST_BASE_URL,
    "the competitor page needs a real session; the local preview Worker cannot mint one",
  );
  test.use({
    storageState: async ({}, use, testInfo) => {
      await use(onboardedStatePath(testInfo.project.name === "phone-390" ? "phone" : "desktop"));
    },
  });

  test("opens the nike.com row", async ({ page }, testInfo) => {
    test.setTimeout(150_000);
    const watched = watchConsole(page);

    await page.goto("/app/competitors");
    await page
      .getByRole("list", { name: "Competitors", exact: true })
      .getByRole("listitem")
      .filter({ hasText: "nike.com" })
      .getByRole("link")
      .click();
    await expect(page).toHaveURL(/\/app\/competitors\/[^/]+$/);

    const sentence = page.getByText("Turn off to stop watching and alerts.", { exact: false });
    await expect(sentence).toBeVisible();

    const toggle = page.getByRole("switch", { name: / tracking (ON|OFF)$/ });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(page.locator("[data-slot='competitor-paused']")).toContainText("Paused");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);

    expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
  });
});
