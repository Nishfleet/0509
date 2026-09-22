import { expect, test } from "@playwright/test";

test.skip(
  Boolean(process.env.PLAYWRIGHT_TEST_BASE_URL),
  "the pair is seeded into the local snapshots bucket the preview server starts with",
);

test("the capture plate opens the before/after pair", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const target = window as Window & { __cls?: number };
    target.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
        if (!shift.hadRecentInput && typeof shift.value === "number") {
          target.__cls = (target.__cls ?? 0) + shift.value;
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });

  const response = await page.goto("/capture-plate");
  expect(response?.status()).toBe(200);

  const phone = (page.viewportSize()?.width ?? 1440) < 860;
  const plate = page.getByRole("button", { name: "Read this first" });
  await expect(plate).toBeVisible();
  const box = await plate.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.round(box?.width ?? 0)).toBe(phone ? 76 : 104);
  expect(Math.round(box?.height ?? 0)).toBe(phone ? 56 : 74);

  const lazy = page.getByRole("button", { name: "Below the fold" }).locator("img");
  await expect(lazy).toHaveAttribute("loading", "lazy");
  await expect(page.getByRole("button", { name: "Read this first" }).locator("img")).toHaveAttribute(
    "loading",
    "eager",
  );
  await expect(page.getByText("No later screenshot was stored.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Missing capture" }).locator("img")).toHaveCount(0);

  await plate.click();
  const open = page.locator(phone ? "[data-slot=sheet-content]" : "[data-slot=dialog-content]");
  await expect(open).toBeVisible();
  const shots = open.locator("img");
  await expect(shots).toHaveCount(2);
  await expect
    .poll(async () =>
      shots.evaluateAll((images) => images.every((image) => image instanceof HTMLImageElement && image.naturalWidth > 0)),
    )
    .toBe(true);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);

  const cls = await page.evaluate(() => (window as Window & { __cls?: number }).__cls ?? 0);
  expect(cls).toBeLessThan(0.05);
  expect(errors).toEqual([]);

  const bare = await page.request.get("/media/shot/e2e/capture-plate/after.png");
  expect(bare.status()).toBe(400);
  const bad = await page.request.get("/media/shot/e2e/capture-plate/after.png?width=abc&height=74");
  expect(bad.status()).toBe(400);
  const other = await page.request.get("/media/mentions/ws/body?width=104&height=74");
  expect(other.status()).toBe(404);
  const image = await page.request.get("/media/shot/e2e/capture-plate/after.png?width=104&height=74");
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"] ?? "").toContain("image/webp");

  await page.screenshot({ path: testInfo.outputPath("plate.png") });
});
