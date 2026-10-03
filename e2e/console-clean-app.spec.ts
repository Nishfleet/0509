import { expect, test } from "@playwright/test";

import { onboardedStatePath } from "../playwright.config";
import { consoleFailures, isLocalLane, watchConsole } from "./inbox";
import { seedRankedHomeSession } from "./ranked-home";

test.use({
  storageState: async ({}, use, testInfo) => {
    await use(
      isLocalLane() ? undefined : onboardedStatePath(testInfo.project.name === "phone-390" ? "phone" : "desktop"),
    );
  },
});

const SIGNED_IN_PAGES = [
  "/app",
  "/app/competitors",
  "/app/alerts",
  "/app/brief",
  "/app/settings",
  "/app/settings/agents",
] as const;

for (const path of SIGNED_IN_PAGES) {
  test(`${path} logs no console errors when signed in @smoke`, async ({ page }, testInfo) => {
    const watched = watchConsole(page);
    if (isLocalLane()) await page.setExtraHTTPHeaders({ cookie: await seedRankedHomeSession("console-clean") });

    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.locator("main")).toBeVisible();

    expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
  });
}
