import { type Page, type TestInfo } from "@playwright/test";
import { expect, test } from "./test";
import type { RouteConfigEntry } from "@react-router/dev/routes";
import routes from "../app/routes";

import { onboardedStatePath } from "../playwright.config";

interface MotionFinding {
  selector: string;
  reason: string;

  duration?: string;
}

function screenPaths(entries: RouteConfigEntry[], parent: string): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.file.endsWith(".ts")) continue;
    const path = [parent, entry.path].filter(Boolean).join("/");
    if (entry.path !== undefined) paths.push(path);
    if (entry.children) paths.push(...screenPaths(entry.children, path));
  }
  return paths;
}

function visitPath(path: string): string {
  if (path === "*") return "/placeholder";
  return `/${path.replace(/:[^/]+/g, "placeholder")}`;
}

async function saveShot(
  page: Page,
  testInfo: TestInfo,
  name: string,
  options: { fullPage?: boolean } = {},
): Promise<void> {
  const file = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: file, fullPage: options.fullPage ?? false });
  await testInfo.attach(name, { path: file, contentType: "image/png" });
}

const targets = ["/", ...screenPaths(routes, "").map(visitPath)];

async function openWatchedCompetitor(page: Page): Promise<void> {
  await page.goto("/app/competitors");

  await page
    .getByRole("list", { name: "Competitors", exact: true })
    .getByRole("listitem")
    .filter({ hasText: "adidas.com" })
    .getByRole("link")
    .click();
  await expect(page).toHaveURL(/\/app\/competitors\/[^/]+$/);
}

async function inspectMotion(page: Page): Promise<MotionFinding[]> {
  return page.evaluate(() => {
    const findings: { selector: string; reason: string; duration?: string }[] = [];
    const label = (element: Element) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}`;

    const animations = new Set<Animation>(document.getAnimations());
    const walk = (root: ParentNode) => {
      for (const element of root.querySelectorAll("*")) {
        for (const animation of element.getAnimations()) animations.add(animation);
        if (element.shadowRoot) walk(element.shadowRoot);
      }
    };
    walk(document);

    for (const animation of animations) {
      const effect = animation.effect;
      const target = effect instanceof KeyframeEffect ? effect.target : null;
      findings.push({
        selector: target ? label(target) : "(detached)",
        reason: `animation present (playState=${animation.playState})`,
      });
    }

    const nonZero = (value: string) => value.split(",").some((part) => Number.parseFloat(part) > 0);

    for (const element of document.querySelectorAll("*")) {
      const cs = getComputedStyle(element);
      if (nonZero(cs.transitionDuration)) {
        findings.push({
          selector: label(element),
          reason: "transition-duration non-zero",
          duration: cs.transitionDuration,
        });
      }
      if (nonZero(cs.animationDuration)) {
        findings.push({
          selector: label(element),
          reason: "animation-duration non-zero",
          duration: cs.animationDuration,
        });
      }
    }
    return findings;
  });
}

test.use({ screenshot: "on" });

for (const target of targets) {
  test(`${target} honours prefers-reduced-motion on first paint`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });

    const response = await page.goto(target);

    const status = response?.status() ?? 0;
    if (status >= 500) {
      throw new Error(`${target} returned ${status}; motion assertions skipped on a broken page`);
    }

    await expect(page.locator("main")).toBeVisible();

    const findings = await inspectMotion(page);

    expect(
      findings,
      `${target} (${testInfo.project.name}): ${findings.length} motion findings — first: ${JSON.stringify(findings[0])}`,
    ).toEqual([]);
  });
}

test.describe("the watched-competitor page's brand switch and its motion @own-signin", () => {
  test.skip(
    !process.env.PLAYWRIGHT_TEST_BASE_URL,
    "the switch tests need a real session; the preview Worker cannot mint one and has no saved state file",
  );

  test.use({
    storageState: async ({ browserName: _browserName }, use, testInfo) => {
      await use(onboardedStatePath(testInfo.project.name === "phone-390" ? "phone" : "desktop"));
    },
  });

  test("the brand switch toggles under reduced motion @own-signin", async ({ page }, testInfo) => {
    test.setTimeout(150_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openWatchedCompetitor(page);

    const toggle = page.getByRole("switch", { name: / tracking (ON|OFF)$/ });
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    const field = page.locator("[data-slot='brand-switch-field'] [data-slot='brand-switch']");
    await expect(field).toHaveAttribute("data-state", "off");
    await expect(page.locator("[data-slot='competitor-paused']")).toContainText("Paused");

    const findings = await inspectMotion(page);
    expect(findings, `after toggle: ${JSON.stringify(findings[0])}`).toEqual([]);

    await saveShot(page, testInfo, "end-state-brand-switch-paused", { fullPage: true });

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  test("control: the switch thumb has a non-zero transition-duration without reduced motion @own-signin", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openWatchedCompetitor(page);

    const thumb = page.locator("[data-slot='brand-switch-field'] [data-slot='switch-thumb']").first();
    await expect(thumb).toBeVisible();

    const duration = await thumb.evaluate((el) => getComputedStyle(el).transitionDuration);

    const numeric = parseFloat(duration);
    expect(
      numeric,
      `expected switch thumb transition-duration > 0 without reduced motion, got "${duration}"`,
    ).toBeGreaterThan(0);
  });
});
