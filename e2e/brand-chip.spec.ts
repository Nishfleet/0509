import { expect, test } from "@playwright/test";

test("a failed logo falls back to the monogram and the row does not scroll or shift", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
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

  const response = await page.goto("/design/brand-chips");
  expect(response?.status()).toBe(200);

  const row = page.locator("[data-slot='brand-chip-row']");
  await expect(row).toBeVisible();
  await expect(row).toHaveCSS("flex-wrap", "wrap");
  await expect(row.locator("[data-slot='avatar']")).toHaveCount(6);

  const broken = page.locator("img[src='/brand-chip-missing.png']");
  await expect(broken).toHaveAttribute("data-error", "");
  await expect(broken).toBeHidden();
  const bramble = page.getByRole("link", { name: "Bramble" });
  await expect(bramble).toContainText("B");
  const brambleBox = await bramble.locator("[data-slot='avatar']").evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  expect(brambleBox.width).toBeCloseTo(26, 0);
  expect(brambleBox.height).toBeCloseTo(26, 0);

  const loaded = page.locator("img[src='/brand-chip-kindred.svg']");
  await expect(loaded).toBeVisible();
  const loadedBox = await loaded.evaluate((el: HTMLImageElement) => ({
    natural: el.naturalWidth,
    width: el.getBoundingClientRect().width,
    height: el.getBoundingClientRect().height,
  }));
  expect(loadedBox.natural).toBe(48);
  expect(loadedBox.width).toBeCloseTo(26, 0);
  expect(loadedBox.height).toBeCloseTo(26, 0);

  const selfMark = page.getByRole("link", { name: "You · Loopwell" }).locator(
    "[data-slot='avatar-fallback']",
  );
  await expect(selfMark).toHaveCSS("background-color", "rgb(22, 196, 127)");

  const off = page.getByRole("link", { name: "Casetta · off" });
  await expect(off).toHaveCSS("border-top-style", "dashed");
  await expect(off).toHaveCSS("color", "rgb(142, 136, 120)");

  const longName = page.getByText("Northbeam International Holdings Group of the Northern Markets");
  await expect(longName).toHaveCSS("text-overflow", "ellipsis");
  const nameWidths = await longName.evaluate((el) => ({
    client: el.clientWidth,
    scroll: el.scrollWidth,
  }));
  const viewport = page.viewportSize()?.width ?? 0;
  if (viewport <= 400) expect(nameWidths.scroll).toBeGreaterThan(nameWidths.client);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);

  const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
  expect(cls).toBeLessThan(0.05);

  const you = page.getByRole("link", { name: "You · Loopwell" });
  await expect(you).toHaveAttribute("href", "/app/competitors/loopwell");
  await page.evaluate(() => {
    (window as unknown as { __stay: number }).__stay = 1;
  });
  await you.click();
  // Client navigation into a signed-in route, and the document must stay.
  // Production has no session, so requireSession sends the click to /login.
  // Local preview's empty D1 makes that lookup throw, so the URL stays on
  // the chip's href. Each mode asserts its own destination.
  const signedOutLandsOnLogin = Boolean(process.env.PLAYWRIGHT_TEST_BASE_URL);
  await page.waitForURL(signedOutLandsOnLogin ? /\/login$/ : /\/app\/competitors\/loopwell$/);
  expect(await page.evaluate(() => (window as unknown as { __stay?: number }).__stay)).toBe(1);
});
