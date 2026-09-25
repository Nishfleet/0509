import { expect, test } from "@playwright/test";

test("an unknown path is a 404 page with one action", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // Chromium reports the document's own 404 as a console error. That line is
    // the status this test asserts. A 404 for any other URL still fails.
    //
    // Match the status code phrase, never the reason phrase. Production is
    // served over HTTP/2, which has no reason phrase, so Chromium prints
    // `status of 404 ()`; the local webServer is HTTP/1.1 and prints
    // `status of 404 (Not Found)`. Pinning the whole line with the phrase
    // made this assertion true only in preview (0509#4244, run 35754687604:
    // expected `404 (Not Found)`, received `404 ()`). `status of 404` is
    // the part Chromium emits in both modes. Measured against the live
    // origin:
    //   curl -s --max-time 20 -o /dev/null -D - https://0509.io/this-page-is-not-here | head -1
    //   HTTP/2 404
    //   curl -s --http1.1 --max-time 20 -o /dev/null -D - https://0509.io/this-page-is-not-here | head -1
    //   HTTP/1.1 404 Not Found
    const failedDocument =
      /status of 404\b/.test(message.text()) &&
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

  const styles = await page.evaluate(async () => {
    const hrefs = [...document.querySelectorAll('link[rel="stylesheet"]')].flatMap((node) =>
      node instanceof HTMLLinkElement ? [node.href] : [],
    );
    const texts = await Promise.all(hrefs.map((href) => fetch(href).then((response) => response.text())));
    return texts.join("\n");
  });
  expect(styles).toContain("bricolage-grotesque-latin");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  expect(errors, testInfo.project.name).toEqual([]);
});
