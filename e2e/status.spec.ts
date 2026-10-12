import { expect, test } from "@playwright/test";

import { consoleFailures, watchConsole } from "./inbox";

test("the status page says the app is working @smoke", async ({ page }, testInfo) => {
  const watched = watchConsole(page);
  const response = await page.goto("/status");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Status" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(/is working/);
  await expect(page.locator("time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T/);
  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
