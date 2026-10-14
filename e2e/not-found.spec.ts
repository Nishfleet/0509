import { expect, test } from "./test";

import { consoleFailures, ownDocument404For, watchConsole } from "./inbox";

test("an unknown path is a 404 page with one action @smoke", async ({ page }, testInfo) => {
  const watched = watchConsole(page);

  const path = "/this-page-is-not-here";
  const response = await page.goto(path);
  expect(response?.status()).toBe(404);

  const headline = page.getByRole("heading", { level: 1 });
  await expect(headline).toHaveText("Page not found");
  await expect(page.getByText("There is no page at /this-page-is-not-here.")).toBeVisible();

  const action = page.getByRole("link");
  await expect(action).toHaveCount(1);
  await expect(action).toHaveText("Back to home");
  await expect(action).toHaveAttribute("href", "/");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);

  const ownDocument404 = ownDocument404For(path);
  expect(await consoleFailures(page, watched, testInfo, ownDocument404), testInfo.project.name).toEqual([]);
});
