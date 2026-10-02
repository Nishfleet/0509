import { expect, test } from "@playwright/test";

import { consoleFailures, watchConsole } from "./inbox";

test("the API reference is generated from the OpenAPI document @smoke", async ({ page, request }, testInfo) => {
  const watched = watchConsole(page);
  const spec = await request.get("/api/v1/openapi.json");
  expect(spec.status()).toBe(200);
  const body: { paths: Record<string, unknown> } = await spec.json();
  const paths = Object.keys(body.paths);

  const response = await page.goto("/api/docs");
  expect(response?.status()).toBe(200);
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  await expect(heading).not.toBeEmpty();

  const main = page.locator("main");
  for (const path of paths) {
    await expect(main, path).toContainText(path);
  }
  await expect(main).toContainText("competitorId");
  await expect(main).toContainText("Missing or invalid API key");
  await expect(main).toContainText("Authorization: Bearer");
  await expect(main).toContainText("/mcp");
  await expect(page.getByRole("link", { name: "Settings" }).first()).toHaveAttribute("href", "/app/settings/agents");

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
  await testInfo.attach(`api-docs-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});

test("the API reference does not scroll sideways at 390 @smoke", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone-390", "measured at 390 only");
  await page.goto("/api/docs");
  await expect(page.locator("main")).toBeVisible();
  const width = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(width.scrollWidth, JSON.stringify(width)).toBe(width.clientWidth);
});
