import { expect, test } from "@playwright/test";

/**
 * Release proof floor for the swept app.
 *
 * REBUILD P2 C3 (#3862) deleted every product surface the original journeys
 * 1-6 exercised, which left the `local-release` project matching zero specs.
 * Playwright exits 1 on "No tests found", and `release-proof` is required by
 * the main-merge-queue ruleset — a job that cannot report is a required check
 * that fails closed, so the gate cannot simply be removed here.
 *
 * So this asserts what is actually true of the app after the sweep: it boots,
 * it serves the auth surface, and it does so without console errors. That is a
 * real proof, not a placeholder — if the Worker fails to start or the surviving
 * route throws, this goes red.
 *
 * C4 (#3863) replaces the app wholesale and brings the journeys the charter
 * names. This file goes with the old app.
 */
test.describe("Gate-B Journey 1: the app boots and serves auth", () => {
  test("sign-in renders without console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(String(error)));

    const response = await page.goto("/auth/login", { waitUntil: "domcontentloaded" });

    expect(response, "the sign-in route must respond").not.toBeNull();
    expect(response!.status(), "sign-in must not 5xx").toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
    expect(consoleErrors, "sign-in must render with no console errors").toEqual([]);
  });
});
