import AxeBuilder from "@axe-core/playwright";
import type { DatabaseSync } from "node:sqlite";

import { expect, type Page, type TestInfo } from "@playwright/test";

import { consoleFailures, isLocalLane, run, seedPreviewSession, watchConsole, watchRequests } from "./inbox";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const MAX_TAB_STOPS = 60;
const MAX_LAYOUT_SHIFT = 0.02;
const STAMP = "2026-10-12T00:00:00.000Z";

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

function resetQuality(quality: Quality): void {
  quality.failedRequests.length = 0;
  quality.watched.consoleErrors.length = 0;
  quality.watched.pageErrors.length = 0;
  quality.watched.prefetchRefused.length = 0;
}

export async function expectNoAxeViolations(page: Page, testInfo: TestInfo, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  await testInfo.attach(`axe ${label}`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });
  expect
    .soft(
      results.violations.map(
        (violation) =>
          `${violation.id} (${violation.impact ?? "unrated"}): ${violation.nodes.map((node) => node.target.join(" ")).join(" | ")}`,
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

async function expectQuiet(page: Page, testInfo: TestInfo, quality: Quality, label: string): Promise<void> {
  await page.waitForLoadState("load");
  const shift = await page.evaluate(() => Number(Reflect.get(window, "__cls")));
  expect.soft(shift, `${label}: layout shift on load`).toBeLessThan(MAX_LAYOUT_SHIFT);
  expect.soft(await consoleFailures(page, quality.watched, testInfo), `${label}: console`).toEqual([]);
  expect.soft(quality.failedRequests, `${label}: failed requests`).toEqual([]);
}

export const SCHEMES = ["light", "dark"] as const;

async function animationsSettled(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.allSettled(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished),
    ).then(() => undefined),
  );
}

export async function scanPage(
  page: Page,
  testInfo: TestInfo,
  quality: Quality,
  label: string,
  options: { screen: RegExp; keyboard: boolean },
): Promise<void> {
  await expect(
    page.getByRole("heading", { name: options.screen }).first(),
    `${label}: the screen under test`,
  ).toBeVisible();
  await animationsSettled(page);
  await expectNoAxeViolations(page, testInfo, label);
  await expectQuiet(page, testInfo, quality, label);
  if (options.keyboard) await expectKeyboardReachesVisibleFocus(page, label);
  resetQuality(quality);
}

export function seedWorkspace(db: DatabaseSync, suffix: string, userId: string, name = "Quality Sweep"): string {
  const workspaceId = `ws-${suffix}`;
  run(
    db,
    "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
    workspaceId,
    name,
    userId,
    STAMP,
  );
  run(
    db,
    "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'self', ?, 'Self Brand', ?)",
    `ent-self-${suffix}`,
    workspaceId,
    `self-${suffix}.example`,
    STAMP,
  );
  return workspaceId;
}

export function seedBareWorkspace(db: DatabaseSync, suffix: string, userId: string): string {
  const workspaceId = `ws-${suffix}`;
  run(
    db,
    "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
    workspaceId,
    "Onboarding",
    userId,
    STAMP,
  );
  return workspaceId;
}

export function seedCompetitor(db: DatabaseSync, suffix: string, workspaceId: string): string {
  const entityId = `ent-z-${suffix}`;
  run(
    db,
    "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?, ?, 'competitor', ?, 'Zephyrwear', 'on', ?)",
    entityId,
    workspaceId,
    `zephyr-${suffix}.example`,
    STAMP,
  );
  run(
    db,
    "INSERT INTO suggestion (id, workspace_id, kind, candidate_domain, candidate_name, verdict_p, verdict_reason, status, created_at) VALUES (?, ?, 'add', ?, 'Northloop', 0.7, 'Sells the same running kit to the same buyers.', 'pending', ?)",
    `sug-${suffix}`,
    workspaceId,
    `northloop-${suffix}.example`,
    STAMP,
  );
  run(
    db,
    "INSERT INTO onboarding_run (id, workspace_id, user_id, input_raw, started_at, watching_started_at) SELECT ?, ?, owner_user_id, 'self.example', ?, ? FROM workspace WHERE id = ?",
    `run-${suffix}`,
    workspaceId,
    STAMP,
    STAMP,
    workspaceId,
  );
  return entityId;
}

export async function signIn(page: Page, baseURL: string | undefined, cookie: string): Promise<void> {
  await page.context().addCookies(
    cookie.split("; ").map((pair) => {
      const [name, ...value] = pair.split("=");
      return { name, value: value.join("="), url: baseURL ?? "" };
    }),
  );
}

export async function signInOnLocalLane(page: Page, baseURL: string | undefined, prefix: string): Promise<void> {
  if (!isLocalLane()) return;
  const { cookie } = await seedPreviewSession(prefix, ({ db, suffix, userId }) => {
    seedCompetitor(db, suffix, seedWorkspace(db, suffix, userId));
  });
  await signIn(page, baseURL, cookie);
}
