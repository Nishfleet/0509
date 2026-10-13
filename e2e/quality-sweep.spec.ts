import type { DatabaseSync } from "node:sqlite";

import { type Page } from "@playwright/test";
import { expect, test } from "./test";

import { isLocalLane, run, seedPreviewSession } from "./inbox";
import {
  expectKeyboardReachesVisibleFocus,
  expectNoSeriousAxe,
  expectQuiet,
  resetQuality,
  startQuality,
} from "./quality";

test.skip(
  !isLocalLane(),
  "the preview Worker signs in through a seeded session; production has the dedicated a11y specs",
);

test.setTimeout(180_000);

const STAMP = "2026-10-12T00:00:00.000Z";
const SCHEMES = ["light", "dark"] as const;

const PUBLIC_PAGES = ["/", "/pricing", "/privacy", "/terms", "/security", "/status", "/login", "/api/docs"];

function seedWorkspace(db: DatabaseSync, suffix: string, userId: string): string {
  const workspaceId = `ws-${suffix}`;
  run(
    db,
    "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
    workspaceId,
    "Quality Sweep",
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

function seedCompetitor(db: DatabaseSync, suffix: string, workspaceId: string): string {
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

async function signIn(page: Page, baseURL: string | undefined, cookie: string): Promise<void> {
  await page.context().addCookies(
    cookie.split("; ").map((pair) => {
      const [name, ...value] = pair.split("=");
      return { name, value: value.join("="), url: baseURL ?? "" };
    }),
  );
}

async function sweep(page: Page, testInfo: Parameters<typeof expectQuiet>[1], paths: string[]): Promise<void> {
  const quality = await startQuality(page);
  for (const path of paths) {
    for (const colorScheme of SCHEMES) {
      await page.emulateMedia({ colorScheme });
      const response = await page.goto(path);
      const label = `${path} ${colorScheme} ${testInfo.project.name}`;
      expect.soft(response?.status(), `${label}: status`).toBe(200);
      await expectNoSeriousAxe(page, testInfo, label);
      await expectQuiet(page, testInfo, quality, label);
      if (colorScheme === "light") await expectKeyboardReachesVisibleFocus(page, label);
      resetQuality(quality);
    }
  }
}

test("every signed-out page passes axe, keyboard focus, layout shift and the console guard", async ({
  page,
}, testInfo) => {
  await sweep(page, testInfo, PUBLIC_PAGES);
});

test("every signed-in page passes axe, keyboard focus, layout shift and the console guard", async ({
  page,
  baseURL,
}, testInfo) => {
  const { cookie, seeded } = await seedPreviewSession("quality-app", ({ db, suffix, userId }) => {
    const workspaceId = seedWorkspace(db, suffix, userId);
    return seedCompetitor(db, suffix, workspaceId);
  });
  await signIn(page, baseURL, cookie);
  await sweep(page, testInfo, [
    "/app",
    "/app/alerts",
    "/app/competitors",
    `/app/competitors/${seeded}`,
    "/app/brief",
    "/app/settings",
    "/app/settings/agents",
  ]);
});

test("the onboarding steps pass axe, keyboard focus, layout shift and the console guard", async ({
  page,
  baseURL,
}, testInfo) => {
  const { cookie } = await seedPreviewSession(
    "quality-input",
    ({ db, suffix, userId }) => {
      seedWorkspace(db, suffix, userId);
    },
    { livePlan: false },
  );
  await signIn(page, baseURL, cookie);
  await sweep(page, testInfo, ["/onboarding"]);
});
