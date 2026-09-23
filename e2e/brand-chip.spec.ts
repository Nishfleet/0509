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

  // The chip's `href` is `/app/competitors/loopwell`, a session-gated route:
  // `requireSession` (app/lib/require-session.server.ts) redirects a visitor
  // with no session to `/login`. Both modes now reach that gate, because
  // playwright.config.ts applies the D1 migrations to the local database
  // before `wrangler dev` starts, exactly as deploy-production.yml does for
  // the real database. Before that the local D1 was empty, so
  // `auth.api.getSession` threw a schema mismatch and the URL stayed on the
  // chip's own href — a preview-only end state that asserted nothing a
  // visitor can reach (0509#4244, run 35754687604: `waitForURL` timeout,
  // "navigated to https://0509.io/login").
  //
  // The design page owns two things here, and both are asserted: the chip
  // points at the app route, and following it is a client-side navigation
  // (React Router handles the loader's redirect in the document, so the
  // `__stay` marker set before the click is still there after). A hard reload
  // would clear it.
  const self = page.getByRole("link", { name: "You · Loopwell" });
  await expect(self).toHaveAttribute("href", "/app/competitors/loopwell");
  await page.evaluate(() => {
    (window as unknown as { __stay: number }).__stay = 1;
  });
  await self.click();
  await page.waitForURL(/\/login$/);
  expect(await page.evaluate(() => (window as unknown as { __stay?: number }).__stay)).toBe(1);
});
