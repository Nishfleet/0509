import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __rowSheetCloseDuration: string | null;
  }
}

const POPUP = '[data-row-sheet-popup]';

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

test("a row opens its sheet from the bottom, dismisses it, and returns focus", async ({ page }) => {
  await page.setViewportSize(PHONE);
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/design/row-sheet");

  const row = page.locator('[data-row-expansion="sheet"]').first();
  await expect(row).toBeVisible();
  const popup = page.locator(POPUP).first();
  await expect(popup).toBeHidden();

  await row.click();
  await expect(popup).toBeVisible();
  await expect(popup).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(popup).toBeHidden();
  await expect(row).toBeFocused();

  await row.click();
  await expect(popup).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(popup).toBeHidden();
  await expect(row).toBeFocused();

  await page.screenshot({ path: "playwright-report/row-sheet-390.png", fullPage: false });

  expect(errors).toEqual([]);
});

test("the sheet carries the 380ms up / 280ms down budget and an 85% ink hairline panel", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await page.goto("/design/row-sheet");

  const row = page.locator('[data-row-expansion="sheet"]').first();
  await row.click();
  const popup = page.locator(POPUP).first();
  await expect(popup).toBeVisible();
  await expect(popup).toBeFocused();

  const open = await popup.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      duration: style.transitionDuration,
      easing: style.transitionTimingFunction,
      box: element.getBoundingClientRect(),
      borderTopColor: style.borderTopColor,
      borderTopWidth: style.borderTopWidth,
    };
  });

  expect(open.duration).toBe("0.38s");
  expect(open.easing).toBe("cubic-bezier(0.32, 0.72, 0, 1)");
  const viewport = page.viewportSize();
  expect(open.box.height / (viewport?.height ?? 1)).toBeCloseTo(0.85, 1);
  expect(open.box.y + open.box.height).toBeCloseTo(viewport?.height ?? 0, 0);
  expect(open.borderTopWidth).toBe("1px");
  expect(open.borderTopColor).toBe("rgb(14, 13, 10)");

  // The close half of the budget, read off the live element at the exact moment
  // Base UI flips the popup into its ending state — no hand-set attribute, no
  // race against the 280ms transition (a plain poll lost that race under load).
  await page.evaluate(() => {
    const element = document.querySelector("[data-row-sheet-popup]");
    if (!element) throw new Error("no row-sheet popup to observe");
    window.__rowSheetCloseDuration = null;
    new MutationObserver(() => {
      if (window.__rowSheetCloseDuration === null && element.hasAttribute("data-ending-style")) {
        window.__rowSheetCloseDuration = getComputedStyle(element).transitionDuration;
      }
    }).observe(element, { attributes: true, attributeFilter: ["data-ending-style"] });
  });
  await page.keyboard.press("Escape");
  await expect
    .poll(() => page.evaluate(() => window.__rowSheetCloseDuration))
    .toBe("0.28s");
});

test("prefers-reduced-motion removes the sheet's motion", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/design/row-sheet");

  const row = page.locator('[data-row-expansion="sheet"]').first();
  await row.click();
  const popup = page.locator(POPUP).first();
  await expect(popup).toBeVisible();

  const duration = await popup.evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(duration).toBe("0s");
});

test("above 860px the row expands in place behind a 4px accent bar", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/design/row-sheet");

  const inPlace = page.locator('[data-row-expansion="in-place"]').first();
  await expect(inPlace).toBeVisible();
  await expect(page.locator('[data-row-expansion="sheet"]')).toHaveCount(0);

  const border = await inPlace.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: style.borderLeftWidth, color: style.borderLeftColor };
  });
  expect(border.width).toBe("4px");
  expect(border.color).toBe("rgb(22, 196, 127)");
});
