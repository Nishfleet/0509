import type { DatabaseSync } from "node:sqlite";

import { type Page } from "@playwright/test";
import { expect, test } from "./test";

import { isLocalLane, run, seedPreviewSession } from "./inbox";

test.skip(!isLocalLane(), "the preview Worker signs in through a seeded session; production has no fixture workspace");

function seedWorkspace(db: DatabaseSync, suffix: string, userId: string): void {
  const stamp = "2026-10-12T00:00:00.000Z";
  const workspaceId = `ws-${suffix}`;
  run(
    db,
    "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
    workspaceId,
    "Brief This Week",
    userId,
    stamp,
  );
  run(
    db,
    "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'self', ?, 'Self Brand', ?)",
    `ent-self-${suffix}`,
    workspaceId,
    `self-${suffix}.example`,
    stamp,
  );
}

async function signIn(page: Page, baseURL: string | undefined, cookie: string): Promise<void> {
  await page.context().addCookies(
    cookie.split("; ").map((pair) => {
      const [name, ...value] = pair.split("=");
      return { name, value: value.join("="), url: baseURL ?? "" };
    }),
  );
}

test("the brief page offers this week so far, read-only, and the preview links back", async ({ page, baseURL }) => {
  const { cookie } = await seedPreviewSession("brief-week", ({ db, suffix, userId }) => {
    seedWorkspace(db, suffix, userId);
  });
  await signIn(page, baseURL, cookie);
  await page.goto("/app/brief");
  await page.getByRole("link", { name: "See this week’s brief so far" }).click();
  await expect(page).toHaveURL(/\/app\/brief-preview$/);
  await expect(page.getByRole("heading", { level: 1, name: "This week so far" })).toBeVisible();
  await expect(page.getByText("Nothing is sent from here")).toBeVisible();
  await page.getByRole("link", { name: "Back to your briefs" }).click();
  await expect(page).toHaveURL(/\/app\/brief$/);
});
