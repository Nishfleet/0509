import type { DatabaseSync } from "node:sqlite";

import { type Page } from "@playwright/test";
import { expect, test } from "./test";

import { isLocalLane, run, seedPreviewSession } from "./inbox";
import { expectKeyboardReachesVisibleFocus, expectNoAxeViolations } from "./quality";

test.skip(
  !isLocalLane(),
  "the preview Worker signs in through a seeded session; production has the dedicated a11y specs",
);

test.setTimeout(240_000);

const STAMP = "2026-10-12T00:00:00.000Z";
const NARROW = [320, 640] as const;
const TITLE_SUFFIX = " · Five to Nine";
const TEXT_SPACING =
  "*{line-height:1.5 !important;letter-spacing:0.12em !important;word-spacing:0.16em !important}p{margin-bottom:2em !important}";

const PUBLIC_PAGES = ["/", "/pricing", "/privacy", "/terms", "/security", "/status", "/login", "/api/docs", "/v/probe"];

function seed({ db, suffix, userId }: { db: DatabaseSync; suffix: string; userId: string }): string {
  const workspaceId = `ws-${suffix}`;
  run(
    db,
    "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, 'Reflow', ?, 'UTC', 1, 8, ?)",
    workspaceId,
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
  run(
    db,
    "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?, ?, 'competitor', ?, 'Zephyrwear', 'on', ?)",
    `ent-z-${suffix}`,
    workspaceId,
    `zephyr-${suffix}.example`,
    STAMP,
  );
  run(
    db,
    "INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at, role) SELECT ?, ?, id, 'mate@example.com', 0, ?, 'teammate' FROM channel WHERE key = 'email'",
    `st-mate-${suffix}`,
    workspaceId,
    STAMP,
  );
  return `ent-z-${suffix}`;
}

async function signIn(page: Page, baseURL: string | undefined, cookie: string): Promise<void> {
  await page.context().addCookies(
    cookie.split("; ").map((pair) => {
      const [name, ...value] = pair.split("=");
      return { name, value: value.join("="), url: baseURL ?? "" };
    }),
  );
}

async function settle(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState("load");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestIdleCallback(() => {
          resolve();
        }),
      ),
  );
}

async function hiddenOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = window.innerWidth;
    const problems: string[] = [];
    const sideways = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (sideways > 0) problems.push(`the page scrolls sideways by ${String(sideways)}px`);
    for (const element of document.body.querySelectorAll("*")) {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const shown = box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.position !== "fixed";
      const text = (element.textContent ?? "").trim();
      if (shown && element.children.length === 0 && text !== "" && box.right > width + 1) {
        problems.push(
          `${element.tagName.toLowerCase()} "${text.slice(0, 30)}" ends at ${String(Math.round(box.right))}px`,
        );
      }
    }
    return problems.slice(0, 5);
  });
}

async function clippedBySpacing(page: Page): Promise<string[]> {
  await page.addStyleTag({ content: TEXT_SPACING });
  return page.evaluate(() => {
    const problems: string[] = [];
    for (const element of document.body.querySelectorAll("*")) {
      const style = getComputedStyle(element);
      const clips = style.overflowY === "hidden" || style.overflowY === "clip";
      const text = (element.textContent ?? "").trim();
      const screenReaderOnly = element.closest(".sr-only, [class*='sr-only']") !== null;
      if (clips && text !== "" && !screenReaderOnly && element.scrollHeight - element.clientHeight > 1) {
        problems.push(`${element.tagName.toLowerCase()} "${text.slice(0, 30)}" is cut off`);
      }
    }
    return problems.slice(0, 5);
  });
}

async function checkPage(page: Page, path: string, titles: Map<string, string>): Promise<void> {
  for (const width of NARROW) {
    await page.setViewportSize({ width, height: 800 });
    await settle(page, path);
    expect.soft(await hiddenOverflow(page), `${path} at ${String(width)}px wide`).toEqual([]);
  }
  expect.soft(await clippedBySpacing(page), `${path} with WCAG text spacing`).toEqual([]);
  const zoomLocked = await page.evaluate(() =>
    /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/.test(
      document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "",
    ),
  );
  expect.soft(zoomLocked, `${path} must not stop pinch zoom`).toBe(false);
  const title = await page.title();
  expect.soft(title.endsWith(TITLE_SUFFIX) || title.length > 0, `${path} has a title`).toBe(true);
  expect.soft(titles.get(title), `${path} shares its title "${title}" with ${titles.get(title) ?? ""}`).toBeUndefined();
  titles.set(title, path);
}

test("signed-out pages reflow at 320px and 200% zoom, survive text spacing, keep zoom and have their own titles", async ({
  page,
}) => {
  const titles = new Map<string, string>();
  for (const path of PUBLIC_PAGES) await checkPage(page, path, titles);
});

test("signed-in pages reflow at 320px and 200% zoom, survive text spacing, keep zoom and have their own titles", async ({
  page,
  baseURL,
}) => {
  const { cookie, seeded } = await seedPreviewSession("reflow-app", seed);
  await signIn(page, baseURL, cookie);
  const titles = new Map<string, string>();
  const paths = [
    "/app",
    "/app/alerts",
    "/app/competitors",
    `/app/competitors/${seeded}`,
    "/app/brief",
    "/app/settings",
    "/app/settings/agents",
  ];
  for (const path of paths) await checkPage(page, path, titles);
});

test("moving to another page in the app tells a screen reader which page arrived", async ({ page, baseURL }) => {
  const { cookie } = await seedPreviewSession("reflow-announce", seed);
  await signIn(page, baseURL, cookie);
  await page.goto("/app");
  const status = page.locator('[data-slot="navigation-pending"]');
  await expect(status).toHaveAttribute("role", "status");
  await expect(status).toHaveText("");

  await page.getByRole("link", { name: "Alerts" }).first().click();
  await expect(page).toHaveURL(/\/app\/alerts$/);
  await expect(status).toHaveText("Alerts");

  await page.getByRole("link", { name: "Competitors" }).first().click();
  await expect(page).toHaveURL(/\/app\/competitors$/);
  await expect(status).toHaveText("Competitors");
});

test("the not-found and dead-link pages pass axe and keyboard focus in both colour schemes", async ({
  page,
}, testInfo) => {
  for (const path of ["/does-not-exist", "/u/probe-token"]) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      const response = await page.goto(path);
      expect.soft(response?.status(), `${path}: status`).toBe(404);
      const label = `${path} ${colorScheme} ${testInfo.project.name}`;
      await expectNoAxeViolations(page, testInfo, label);
      await expectKeyboardReachesVisibleFocus(page, label);
    }
  }
});
