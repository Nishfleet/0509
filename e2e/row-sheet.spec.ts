import { expect, test } from "@playwright/test";

// The one mobile row expansion (0509#4021). The rows are the static fixture at
// /design/row-sheet, which exists for this spec and is traced in
// docs/FEATURE-MAP.md: gated surfaces cannot carry it because `wrangler dev
// --local` starts with an empty database (see e2e/smoke.spec.ts's own note).
//
// Every assertion here is the packet's acceptance, not a restatement of the
// component: a real row's sheet opens and dismisses, focus moves in and comes
// back to the row, there are no console errors, the reduced-motion path reads
// 0s off the live DOM, and the motion budget is 380ms up / 280ms down.
//
// The suite runs twice, desktop-1440 and phone-390. The sheet is defined below
// 860px, so the sheet specs set a 390x844 viewport and the in-place spec sets
// 1440x900 — both are facts about the component rather than facts about
// whichever project happened to run them.

const ROW = '[data-row-expansion="sheet"]';
const POPUP = "#row-sheet-popup";
const ACCENT_RULE = '[data-row-expansion="in-place"][data-row-expansion-accent]';

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

  const row = page.locator(ROW).first();
  await expect(row).toBeVisible();
  const popup = page.locator(POPUP);
  await expect(popup).toBeHidden();

  await row.click();
  await expect(popup).toBeVisible();
  await expect(popup).toBeFocused();

  const box = await popup.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    // Flush with the bottom edge: the sheet comes up from below, it does not
    // float. toBeGreaterThanOrEqual because 85% of the viewport sits exactly
    // on the bottom of the viewport.
    expect(box.y + box.height).toBeGreaterThanOrEqual(page.viewportSize()?.height ?? 0);
  }

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

  const row = page.locator(ROW).first();
  await row.click();
  const popup = page.locator(POPUP);
  await expect(popup).toBeVisible();

  const motion = await popup.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      duration: style.transitionDuration,
      property: style.transitionProperty,
      timing: style.transitionTimingFunction,
      height: element.getBoundingClientRect().height,
      viewport: window.innerHeight,
      borderTopColor: style.borderTopColor,
      borderTopWidth: style.borderTopWidth,
    };
  });

  expect(motion.property).toContain("transform");
  expect(motion.duration).toBe("0.38s");
  expect(motion.timing).toContain("cubic-bezier(0.32, 0.72, 0, 1)");
  expect(motion.height / motion.viewport).toBeCloseTo(0.85, 1);
  expect(motion.borderTopWidth).toBe("1px");
  // DESIGN.md §8: an ink hairline top edge. --ink is #0e0d0a, so the hairline is
  // near-black rather than a theme accent colour.
  expect(motion.borderTopColor).toBe("rgb(14, 13, 10)");

  // The close half of the budget. Base UI sets `data-ending-style` on the popup
  // the moment it starts closing, and the rule that attribute targets is what
  // must read 280ms. Read it while the sheet is open by toggling the attribute
  // for one synchronous beat: it resolves the exact rule the close transition
  // runs on, and it is deterministic where reading mid-transition is not.
  const endingDuration = await popup.evaluate((element) => {
    element.setAttribute("data-ending-style", "");
    const value = getComputedStyle(element).transitionDuration;
    element.removeAttribute("data-ending-style");
    return value;
  });
  expect(endingDuration).toBe("0.28s");
});

test("prefers-reduced-motion removes the sheet's motion", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/design/row-sheet");

  const row = page.locator(ROW).first();
  await row.click();
  const popup = page.locator(POPUP);
  await expect(popup).toBeVisible();

  const duration = await popup.evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(duration).toBe("0s");
});

test("above 860px the row expands in place behind a 4px accent bar", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/design/row-sheet");

  const inPlace = page.locator(ACCENT_RULE).first();
  await expect(inPlace).toBeVisible();
  await expect(page.locator(ROW)).toHaveCount(0);

  const border = await inPlace.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: style.borderLeftWidth, color: style.borderLeftColor };
  });
  expect(border.width).toBe("4px");
  // DESIGN.md §2: the expanded row is marked by a 4px accent bar on its left
  // edge. --green light is #16c47f, so the bar is green rather than ink.
  expect(border.color).toBe("rgb(22, 196, 127)");
});
