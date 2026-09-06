import { expect, type Locator, type Page } from "@playwright/test";

export const PHONE_MAX_WIDTH = 600;
export const MIN_TOUCH_TARGET_PX = 44;
const RENDERED_BOX_EPSILON_PX = 0.001;
const MAX_REPORTED_FAILURES = 20;

export type BoxSize = {
  width: number;
  height: number;
};

export type FocusStyle = {
  outlineStyle?: string;
  outlineWidth?: string;
  outlineColor?: string;
  boxShadow?: string;
};

export type ReducedMotionStyle = {
  animationName?: string;
  animationDuration?: string;
  transitionProperty?: string;
  transitionDuration?: string;
  scrollBehavior?: string;
};

export type OverflowSnapshot = {
  scrollWidth: number;
  clientWidth: number;
};

export function horizontalOverflowPx({ scrollWidth, clientWidth }: OverflowSnapshot): number {
  return Math.max(0, scrollWidth - clientWidth);
}

export function hasMinimumTouchTarget(box: BoxSize, minimum = MIN_TOUCH_TARGET_PX): boolean {
  return (
    box.width >= minimum - RENDERED_BOX_EPSILON_PX &&
    box.height >= minimum - RENDERED_BOX_EPSILON_PX
  );
}

export function focusAdvanceKey(browserName: string | undefined, key = "Tab"): string {
  // Safari/WebKit on macOS uses Option+Tab to include links in sequential
  // keyboard navigation when the platform's full-keyboard-access setting is
  // not enabled. This remains the real browser gesture, not a direct focus().
  return browserName === "webkit" && key === "Tab" ? "Alt+Tab" : key;
}

function cssLengthInPixels(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function isTransparentColor(value: string | undefined): boolean {
  return !value || value === "transparent" || /rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/u.test(value);
}

export function hasVisibleFocusTreatment(style: FocusStyle): boolean {
  const visibleOutline =
    style.outlineStyle !== undefined &&
    style.outlineStyle !== "none" &&
    cssLengthInPixels(style.outlineWidth) > 0 &&
    !isTransparentColor(style.outlineColor);
  const visibleShadow = style.boxShadow !== undefined && style.boxShadow !== "none";
  return visibleOutline || visibleShadow;
}

function maxDurationMs(value: string | undefined): number {
  return (value ?? "0s")
    .split(",")
    .map((part) => part.trim())
    .reduce((maximum, part) => {
      if (part.endsWith("ms")) return Math.max(maximum, Number.parseFloat(part) || 0);
      if (part.endsWith("s")) return Math.max(maximum, (Number.parseFloat(part) || 0) * 1000);
      return maximum;
    }, 0);
}

export function reducedMotionIssues(style: ReducedMotionStyle): string[] {
  const issues: string[] = [];
  if (style.animationName && style.animationName !== "none" && maxDurationMs(style.animationDuration) > 0) {
    issues.push(`animation ${style.animationName} remains active`);
  }
  if (style.transitionProperty && style.transitionProperty !== "none" && maxDurationMs(style.transitionDuration) > 0) {
    issues.push(`transition ${style.transitionProperty} remains active`);
  }
  if (style.scrollBehavior === "smooth") {
    issues.push("scroll behavior remains smooth");
  }
  return issues;
}

export async function expectNoHorizontalOverflow(page: Page, tolerance = 1): Promise<void> {
  const overflow = await page.evaluate(({ allowed, maxReportedFailures }) => {
    const nested = Array.from(document.querySelectorAll<HTMLElement>("*"))
      .map((element) => ({
        element,
        overflow: Math.max(0, element.scrollWidth - element.clientWidth),
      }))
      .filter(({ element, overflow }) => {
        if (overflow <= Math.max(allowed, 2) || element.classList.contains("f9-sr-only") || element.classList.contains("ld-sr-only")) {
          return false;
        }
        // A native select's popup options can be wider than its closed control,
        // but that internal menu width does not participate in document layout.
        if (element instanceof HTMLSelectElement) {
          return false;
        }
        const style = getComputedStyle(element);
        // Inline boxes do not establish a scroll container. Firefox reports
        // their text width as scrollWidth while clientWidth remains zero,
        // which is not page overflow. Document-level overflow below still
        // catches inline content that genuinely escapes the viewport.
        if (style.display === "inline" || style.display === "contents") return false;
        const overflowX = style.overflowX;
        return !["auto", "scroll", "hidden", "clip"].includes(overflowX);
      })
      .map(({ element, overflow }) => ({
        selector: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${element.className && typeof element.className === "string" ? `.${element.className.trim().split(/\s+/u).join(".")}` : ""}`,
        overflow,
      }))
      .slice(0, maxReportedFailures);
    return {
      document: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      nested,
    };
  }, { allowed: tolerance, maxReportedFailures: MAX_REPORTED_FAILURES });

  expect(overflow.document, "document should not overflow horizontally").toBeLessThanOrEqual(tolerance);
  expect(overflow.nested, "nested elements should not overflow horizontally").toEqual([]);
}

export async function expectPrimaryActionAboveFold(
  action: Locator,
  label = "primary next action",
): Promise<void> {
  await expect(action, `${label} should be visible`).toBeVisible();
  // The assertion checks the *initial* viewport, so measure from the top of
  // the page. WebKit auto-scrolls ~11px on mobile when a field is filled
  // (e.g. Journey 2 onboarding on a 375x812 viewport), which makes
  // boundingBox() viewport-relative and pushes the action's box.y negative
  // even though the layout is correct at scroll origin. Reset scroll first
  // so the measurement matches the assertion's stated intent.
  await action.page().evaluate(() => window.scrollTo(0, 0));
  const box = await action.boundingBox();
  const viewport = action.page().viewportSize();
  expect(box, `${label} should have a measurable bounding box`).not.toBeNull();
  expect(viewport, `${label} requires a configured viewport`).not.toBeNull();
  if (!box || !viewport) return;
  expect(box.y, `${label} should begin inside the initial viewport`).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, `${label} should be above the initial viewport fold`).toBeLessThanOrEqual(viewport.height);
}

export async function expectMinimumTouchTarget(
  control: Locator,
  minimum = MIN_TOUCH_TARGET_PX,
): Promise<void> {
  await expect(control, "touch target should be visible").toBeVisible();
  const box = await control.boundingBox();
  expect(box, "touch target should have a measurable bounding box").not.toBeNull();
  if (!box) return;
  expect(
    hasMinimumTouchTarget(box, minimum),
    `touch target should be at least ${minimum}x${minimum}px; measured ${box.width.toFixed(2)}x${box.height.toFixed(2)}px`,
  ).toBe(true);
}

export async function expectSecHeadingsNonZeroWidth(page: Page): Promise<void> {
  // Issue #1842 regression guard: at tablet (768px) the section header is a
  // flex row (.f9-wk-sec-head, justify-content: space-between) holding the
  // title container (.f9-wk-sec-headings, min-width: 0) and the actions block
  // (.f9-wk-sec-acts, flex: 0 0 auto, flex-wrap: nowrap). When the actions
  // overflow the row, .f9-wk-sec-headings collapses to width: 0 — the title
  // stays in the DOM but is invisible. toBeVisible() catches the symptom;
  // this pins the cause by asserting the headings container keeps a non-zero
  // width whenever the actions are present, on every viewport the journey
  // runs (mobile wraps, desktop has room, tablet is the dead zone).
  //
  // Both elements are asserted present (not silently skipped): the empty
  // state always renders the pair, so a missing .f9-wk-sec-acts would be a
  // real markup regression and must fail loudly rather than pass the guard.
  const secActs = page.locator(".f9-wk-sec-acts").first();
  await expect(secActs, ".f9-wk-sec-acts should be present and visible").toHaveCount(1);
  await expect(secActs, ".f9-wk-sec-acts should be visible").toBeVisible();
  const headings = page.locator(".f9-wk-sec-headings").first();
  await expect(headings, ".f9-wk-sec-headings should be present").toHaveCount(1);
  const box = await headings.boundingBox();
  expect(box, ".f9-wk-sec-headings should render a bounding box").not.toBeNull();
  if (!box) return;
  expect(
    box.width,
    ".f9-wk-sec-headings must keep non-zero width so .f9-wk-sec-acts cannot collapse it (tablet guard, #1842)",
  ).toBeGreaterThan(0);
}

export async function expectVisibleKeyboardFocus(control: Locator): Promise<void> {
  await control.focus();
  await expect(control, "keyboard focus should land on the control").toBeFocused();
  const styles = await control.evaluate((element) => {
    const candidates = [element, element.parentElement, element.parentElement?.parentElement].filter(Boolean) as Element[];
    return candidates.map((candidate) => {
      const computed = getComputedStyle(candidate);
      return {
        outlineStyle: computed.outlineStyle,
        outlineWidth: computed.outlineWidth,
        outlineColor: computed.outlineColor,
        boxShadow: computed.boxShadow,
      } satisfies FocusStyle;
    });
  });
  expect(styles.some(hasVisibleFocusTreatment), "focused control should retain a visible focus treatment").toBe(true);
}

export async function expectFocusTransition(from: Locator, to: Locator, key = "Tab"): Promise<void> {
  await from.focus();
  await expect(from, "focus transition should start on the source control").toBeFocused();
  const browserName = from.page().context().browser()?.browserType().name();
  const advanceKey = focusAdvanceKey(browserName, key);
  await from.page().keyboard.press(advanceKey);
  await expect(to, `focus transition should land on ${advanceKey}`).toBeFocused();
}

export async function expectStatusAnnouncement(
  announcement: Locator,
  expectedText: string | RegExp,
  role: "status" | "alert" = "status",
): Promise<void> {
  await expect(announcement, "status announcement should be attached").toBeAttached();
  await expect(announcement).toHaveAttribute("role", role);
  await expect(announcement).toHaveAttribute("aria-live", /^(?:polite|assertive)$/u);
  await expect(announcement).toContainText(expectedText);
}

export async function expectPhoneTouchTargets(
  page: Page,
  minimum = MIN_TOUCH_TARGET_PX,
): Promise<void> {
  const viewport = page.viewportSize();
  expect(viewport, "phone touch-target checks require a configured viewport").not.toBeNull();
  if (!viewport || viewport.width > PHONE_MAX_WIDTH) return;

  const failures = await page.locator("button, a, input, select, textarea, [role='button'], [tabindex]").evaluateAll(
    (elements, { minSize, epsilon }) => elements
      .filter((element) => {
        const html = element as HTMLElement;
        const style = getComputedStyle(html);
        const inputType = html instanceof HTMLInputElement ? html.type : "";
        const labeledControl = inputType === "checkbox" || inputType === "radio"
          ? html.closest("label")
          : null;
        const rect = (labeledControl ?? html).getBoundingClientRect();
        const isInlineProseLink =
          html.tagName === "A" &&
          style.display === "inline" &&
          Boolean(html.closest("p, li, dd"));
        // tabindex="-1" on a non-interactive element (e.g. a heading used as
        // a programmatic focus target) is not a pointer-operable control, so
        // the WCAG 2.5.5 touch-target floor does not apply to it. Inherently
        // interactive tags (button/a/input/select/textarea) and role="button"
        // are still checked even with tabindex="-1".
        const isInherentlyInteractive =
          html instanceof HTMLButtonElement ||
          html.tagName === "A" ||
          html instanceof HTMLInputElement ||
          html instanceof HTMLSelectElement ||
          html instanceof HTMLTextAreaElement ||
          html.getAttribute("role") === "button";
        const isProgrammaticFocusTarget =
          html.getAttribute("tabindex") === "-1" && !isInherentlyInteractive;
        const isRendered = html.checkVisibility() && rect.width > 0 && rect.height > 0;
        return (
          isRendered &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          !isInlineProseLink &&
          !isProgrammaticFocusTarget &&
          html.getAttribute("aria-hidden") !== "true" &&
          html.getAttribute("aria-disabled") !== "true" &&
          !html.hasAttribute("disabled")
        );
      })
      .map((element) => {
        const html = element as HTMLElement;
        const inputType = html instanceof HTMLInputElement ? html.type : "";
        const labeledControl = inputType === "checkbox" || inputType === "radio"
          ? html.closest("label")
          : null;
        const rect = (labeledControl ?? html).getBoundingClientRect();
        return {
          label: html.getAttribute("aria-label") || html.textContent?.trim().slice(0, 40) || html.tagName.toLowerCase(),
          tag: html.tagName.toLowerCase(),
          type: html instanceof HTMLInputElement ? html.type : null,
          name: html.getAttribute("name"),
          className: html.className,
          width: rect.width,
          height: rect.height,
        };
      })
      // Use the same sub-pixel epsilon as hasMinimumTouchTarget so a control
      // that renders at 43.99998px due to font/box rounding is not flagged.
      .filter((box) => box.width < minSize - epsilon || box.height < minSize - epsilon),
    { minSize: minimum, epsilon: RENDERED_BOX_EPSILON_PX },
  );

  expect(failures.slice(0, MAX_REPORTED_FAILURES), `actionable phone controls should be at least ${minimum}x${minimum}px`).toEqual([]);
}

export async function expectReducedMotionSafe(page: Page, root: Locator = page.locator("body")): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const styles = await root.evaluate((rootElement) => [rootElement, ...rootElement.querySelectorAll("*")]
    .map((element) => {
      const computed = getComputedStyle(element);
      return {
        element: element.tagName.toLowerCase(),
        style: {
          animationName: computed.animationName,
          animationDuration: computed.animationDuration,
          transitionProperty: computed.transitionProperty,
          transitionDuration: computed.transitionDuration,
          scrollBehavior: computed.scrollBehavior,
        },
      };
    }));
  const failures = styles
    .map(({ element, style }) => ({ element, issues: reducedMotionIssues(style) }))
    .filter(({ issues }) => issues.length > 0)
    .slice(0, MAX_REPORTED_FAILURES);

  expect(failures, "reduced-motion mode should disable animated transitions and smooth scrolling").toEqual([]);
}
