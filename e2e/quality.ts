import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";

import { consoleFailures, watchConsole, watchRequests } from "./inbox";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const MAX_TAB_STOPS = 60;
const MAX_LAYOUT_SHIFT = 0.02;

export interface Quality {
  watched: ReturnType<typeof watchConsole>;
  failedRequests: string[];
}

export async function startQuality(page: Page): Promise<Quality> {
  await page.addInitScript(() => {
    Reflect.set(window, "__cls", 0);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!Reflect.get(entry, "hadRecentInput")) {
          Reflect.set(window, "__cls", Number(Reflect.get(window, "__cls")) + Number(Reflect.get(entry, "value")));
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  const failedRequests = watchRequests(page);
  return { watched: watchConsole(page), failedRequests };
}

export function resetQuality(quality: Quality): void {
  quality.failedRequests.length = 0;
  quality.watched.consoleErrors.length = 0;
  quality.watched.pageErrors.length = 0;
  quality.watched.prefetchRefused.length = 0;
}

export async function expectNoSeriousAxe(page: Page, testInfo: TestInfo, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  await testInfo.attach(`axe ${label}`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });
  const blocking = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect
    .soft(
      blocking.map(
        (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(" | ")}`,
      ),
      label,
    )
    .toEqual([]);
}

export async function expectKeyboardReachesVisibleFocus(page: Page, label: string): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  const problems: string[] = [];
  let stops = 0;
  for (let step = 0; step < MAX_TAB_STOPS; step += 1) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const element = document.activeElement;
      if (element === null || element === document.body) return null;
      const box = element.getBoundingClientRect();
      const ring = () => {
        const style = getComputedStyle(element);
        const outlined = style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0;
        return `${outlined ? `${style.outlineWidth} ${style.outlineColor}` : "none"}|${style.boxShadow}`;
      };
      const focused = ring();
      if (element instanceof HTMLElement) element.blur();
      const resting = ring();
      if (element instanceof HTMLElement) element.focus();
      const described = `${element.tagName.toLowerCase()}${element.id === "" ? "" : `#${element.id}`} "${(element.textContent ?? "").trim().slice(0, 30)}"`;
      return { described, sized: box.width > 0 && box.height > 0, ringed: focused !== resting };
    });
    if (stop === null) break;
    stops += 1;
    if (!stop.sized) problems.push(`${stop.described} took focus with no size`);
    if (!stop.ringed) problems.push(`${stop.described} shows no focus ring`);
  }
  expect.soft(problems, `${label}: ${String(stops)} tab stops`).toEqual([]);
}

export async function expectQuiet(page: Page, testInfo: TestInfo, quality: Quality, label: string): Promise<void> {
  await page.waitForLoadState("load");
  const shift = await page.evaluate(() => Number(Reflect.get(window, "__cls")));
  expect.soft(shift, `${label}: layout shift on load`).toBeLessThan(MAX_LAYOUT_SHIFT);
  expect.soft(await consoleFailures(page, quality.watched, testInfo), `${label}: console`).toEqual([]);
  expect.soft(quality.failedRequests, `${label}: failed requests`).toEqual([]);
}
