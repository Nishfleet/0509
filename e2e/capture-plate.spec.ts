import { expect, test } from "@playwright/test";

test("a capture plate keeps its size, opens the pair, and falls back with no shift", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
        if (!shift.hadRecentInput) cls += shift.value ?? 0;
      }
    }).observe({ type: "layout-shift", buffered: true });
    Object.defineProperty(window, "__cls", { get: () => cls });
  });

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    if (msg.location().url.split("?")[0].endsWith("/capture-plate-missing.svg")) return;
    consoleErrors.push(msg.text());
  });

  const response = await page.goto("/design/capture-plates");
  expect(response?.status()).toBe(200);

  const plates = page.locator("[data-slot='capture-plate']");
  await expect(plates).toHaveCount(3);

  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  const wide = viewport.width >= 860;
  const firstBox = await plates.nth(0).boundingBox();
  expect(firstBox?.width).toBeCloseTo(wide ? 104 : 76, 0);
  expect(firstBox?.height).toBeCloseTo(wide ? 74 : 56, 0);

  await expect(plates.nth(0).locator("img")).toHaveAttribute("loading", "eager");
  await expect(plates.nth(1)).toContainText("Capture failed: page timed out");
  await expect(plates.nth(1).locator("img")).toHaveCount(0);
  await expect(plates.nth(2)).toContainText("Screenshot unavailable");
  await expect(plates.nth(2).locator("img")).toHaveCount(0);

  await plates.nth(0).click();
  const pair = page.locator("[data-slot='capture-pair']");
  await expect(pair).toBeVisible();
  await expect
    .poll(async () =>
      pair.locator("img").evaluateAll((images) =>
        images.map((image) => (image as HTMLImageElement).naturalWidth > 0),
      ),
    )
    .toEqual([true, true]);

  const pairBox = await pair.boundingBox();
  if (wide) {
    const centre = (pairBox?.x ?? 0) + (pairBox?.width ?? 0) / 2;
    expect(Math.abs(centre - viewport.width / 2)).toBeLessThanOrEqual(2);
  } else {
    expect(Math.abs((pairBox?.y ?? 0) + (pairBox?.height ?? 0) - viewport.height)).toBeLessThanOrEqual(2);
    expect(pairBox?.width).toBeCloseTo(viewport.width, 0);
  }

  await page.keyboard.press("Escape");
  await expect(pair).toBeHidden();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);

  const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
  expect(cls).toBeLessThan(0.05);

  expect(consoleErrors).toEqual([]);
});
