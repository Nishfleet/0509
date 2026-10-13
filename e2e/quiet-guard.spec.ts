import { type Page } from "@playwright/test";

import { expect, expectNoise, test } from "./test";

async function logError(page: Page, message: string): Promise<void> {
  await page.goto("/");
  await page.evaluate((text) => {
    console.error(text);
  }, message);
}

test("the guard fails a test whose page logs a console error @smoke", async ({ page }) => {
  test.fail();
  await logError(page, "planted console error");
});

test("the guard fails a test whose page threw after it closed @smoke", async ({ context }) => {
  test.fail();
  const page = await context.newPage();
  await logError(page, "planted error on a page that is then closed");
  await page.close();
});

test("the guard lets an error the test names through @smoke", async ({ page }) => {
  expectNoise(/planted noise/i);
  await logError(page, "Planted Noise from the test");
  await expect(page.locator("main")).toBeVisible();
});

test("the guard passes a test that closes a clean page it opened @smoke", async ({ context }) => {
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator("main")).toBeVisible();
  await page.close();
});
