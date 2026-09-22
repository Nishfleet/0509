import { expect, test } from "@playwright/test";

test("an unknown path is a 404 page with one action", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // Chromium reports the document's own 404 as a console error. That line is
    // the status this test asserts. A 404 for any other URL still fails.
    const failedDocument =
      message.text() === "Failed to load resource: the server responded with a status of 404 (Not Found)" &&
      message.location().url.endsWith("/this-page-is-not-here");
    if (failedDocument) return;
    errors.push(`${message.text()} @ ${message.location().url}`);
  });
  page.on("pageerror", (error) => errors.push(error.message));

  const response = await page.goto("/this-page-is-not-here");
  expect(response?.status()).toBe(404);

  const headline = page.getByRole("heading", { level: 1 });
  await expect(headline).toHaveText("This page is not here");
  await expect(page.getByText("Nothing in the product lives at /this-page-is-not-here.")).toBeVisible();

  const action = page.getByRole("link");
  await expect(action).toHaveCount(1);
  await expect(action).toHaveText("Back to the landing");
  await expect(action).toHaveAttribute("href", "/");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  expect(errors, testInfo.project.name).toEqual([]);
});
