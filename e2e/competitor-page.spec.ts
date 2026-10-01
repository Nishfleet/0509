import { expect, test } from "@playwright/test";

import { onboardedStatePath } from "../playwright.config";
import { consoleFailures, watchConsole } from "./inbox";

test("a competitor page sends a signed-out visitor to the login page @smoke", async ({ request }) => {
  const response = await request.get("/app/competitors/ent-anything", { maxRedirects: 0 });
  expect(response.status()).toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);
  expect(response.headers()["location"]).toMatch(/\/login/);
});

test("a change's screenshot is never served to a signed-out visitor @smoke", async ({ request }) => {
  for (const side of ["before", "after"]) {
    const response = await request.get(`/app/changes/sig-anything/${side}`, { maxRedirects: 0 });
    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.status()).toBeLessThan(400);
    expect(response.headers()["location"]).toMatch(/\/login/);
    expect(response.headers()["content-type"] ?? "").not.toContain("image/");
  }
});

// The switch test against the real detail page, production only: the preview
// Worker has no EMAIL binding and no inbox to read, so it cannot mint a
// session, and this describe skips there rather than fake the journey. The
// signed-in one comes from onboarded.setup.ts — a real /app/competitors/:entityId
// page for gymshark.com exists in the shared session before any test uses it.
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
      .getByRole("list", { name: "Competitors" })
      .getByRole("listitem")
      .filter({ hasText: "nike.com" })
      .getByRole("link")
      .click();
    await expect(page).toHaveURL(/\/app\/competitors\/[^/]+$/);

    const sentence = page.getByText("Turn off to stop watching and alerts.", { exact: false });
    await expect(sentence).toBeVisible();

    // Exactly one switch on the detail page — the watched competitor's own, whose
    // accessible name is "<brand> tracking ON|OFF" (app/components/brand-switch.tsx).
    const toggle = page.getByRole("switch", { name: / tracking (ON|OFF)$/ });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(page.locator("[data-slot='competitor-paused']")).toContainText("Paused");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // The account is shared with every other consumer of this session, so the
    // switch is turned back on before the test ends; a run that left nike.com
    // off would break the next test to read it.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);

    await testInfo.attach("app-competitor", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
  });
});
