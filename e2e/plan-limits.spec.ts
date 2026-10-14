import type { DatabaseSync } from "node:sqlite";

import { isLocalLane, run, seedPreviewSession } from "./inbox";
import { scanPage, seedCompetitor, seedWorkspace, signIn, startQuality } from "./quality";
import { expect, test } from "./test";

test.skip(!isLocalLane(), "seeds a workspace in the local preview database; never run against production");

test.setTimeout(120_000);

const STAMP = "2026-10-01T00:00:00.000Z";

function seedScoutPlan(db: DatabaseSync, workspaceId: string): void {
  run(
    db,
    "INSERT INTO plan (id, workspace_id, tier, status, trialing, provider_customer_id, provider_subscription_id, current_period_end, updated_at) VALUES (?, ?, 'scout', 'active', 0, ?, ?, ?, ?)",
    `plan-${workspaceId}`,
    workspaceId,
    `cus_${workspaceId}`,
    `sub_${workspaceId}`,
    new Date(Date.now() + 20 * 86_400_000).toISOString(),
    STAMP,
  );
}

function seedExtraRivals(db: DatabaseSync, suffix: string, workspaceId: string, count: number): void {
  for (let index = 0; index < count; index += 1) {
    run(
      db,
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?, ?, 'competitor', ?, ?, 'on', ?)",
      `ent-extra-${String(index)}-${suffix}`,
      workspaceId,
      `extra-${String(index)}-${suffix}.example`,
      `Extra Rival ${String(index)}`,
      STAMP,
    );
  }
}

test("a full plan says so on Competitors and the See plans link opens pricing", async ({ page, baseURL }, testInfo) => {
  const quality = await startQuality(page);
  const { cookie } = await seedPreviewSession("plan-full", ({ db, suffix, userId }) => {
    const workspaceId = seedWorkspace(db, suffix, userId);
    seedCompetitor(db, suffix, workspaceId);
    seedExtraRivals(db, suffix, workspaceId, 4);
    seedScoutPlan(db, workspaceId);
  });
  await signIn(page, baseURL, cookie);
  await page.goto("/app/competitors");

  const meter = page.locator('[data-slot="competitor-count"]');
  await expect(meter).toContainText("Watching 5 of 5 competitors. Your plan is full.");
  await scanPage(page, testInfo, quality, `/app/competitors plan full ${testInfo.project.name}`, {
    screen: /^competitors$/i,
    keyboard: true,
  });

  await meter.getByRole("link", { name: "See plans" }).click();
  await expect(page).toHaveURL(/\/pricing$/);
});

test("a plan with room shows the count and no See plans link", async ({ page, baseURL }) => {
  const { cookie } = await seedPreviewSession("plan-room", ({ db, suffix, userId }) => {
    const workspaceId = seedWorkspace(db, suffix, userId);
    seedCompetitor(db, suffix, workspaceId);
    seedScoutPlan(db, workspaceId);
  });
  await signIn(page, baseURL, cookie);
  await page.goto("/app/competitors");

  const meter = page.locator('[data-slot="competitor-count"]');
  await expect(meter).toContainText("Watching 1 of 5 competitors on your plan.");
  await expect(meter.getByRole("link", { name: "See plans" })).toHaveCount(0);
});

test("one address cannot be invited a fourth time in a day and is told so calmly", async ({
  page,
  baseURL,
}, testInfo) => {
  const { cookie } = await seedPreviewSession("recipient-cap", ({ db, suffix, userId }) => {
    const workspaceId = seedWorkspace(db, suffix, userId);
    seedCompetitor(db, suffix, workspaceId);
  });
  await signIn(page, baseURL, cookie);
  await page.goto("/app/settings");

  const teammate = `cap-${Date.now().toString(36)}-${testInfo.project.name}@example.com`;
  const field = page.getByLabel("Teammate's email");
  for (let round = 0; round < 3; round += 1) {
    await field.fill(teammate);
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: teammate })).toContainText("waiting for them to confirm");
    await page.getByRole("button", { name: `Remove ${teammate}` }).click();
    await expect(page.getByRole("listitem").filter({ hasText: teammate })).toBeHidden();
  }

  await field.fill(teammate);
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.locator("#teammate-error")).toContainText("That address has had several emails from us today.");
  await expect(page.getByRole("listitem").filter({ hasText: teammate })).toHaveCount(0);
});
