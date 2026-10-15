import type { DatabaseSync } from "node:sqlite";

import { isLocalLane, run, seedPreviewSession } from "./inbox";
import { hiddenOverflow, scanPage, seedWorkspace, signIn, startQuality } from "./quality";
import { expect, test } from "./test";

test.skip(!isLocalLane(), "seeds a workspace in the local preview database; never run against production");

test.setTimeout(120_000);

const STAMP = "2026-10-01T00:00:00.000Z";

function seedPlan(db: DatabaseSync, workspaceId: string, tier: "agency" | "starter"): void {
  run(
    db,
    "INSERT INTO plan (id, workspace_id, tier, status, trialing, provider_customer_id, provider_subscription_id, current_period_end, updated_at) VALUES (?, ?, ?, 'active', 0, ?, ?, ?, ?)",
    `plan-${workspaceId}`,
    workspaceId,
    tier,
    `cus_${workspaceId}`,
    `sub_${workspaceId}`,
    new Date(Date.now() + 20 * 86_400_000).toISOString(),
    STAMP,
  );
}

test("an Agency owner adds a client brand from the keyboard and can get back to the first brand", async ({
  page,
  baseURL,
}, testInfo) => {
  const quality = await startQuality(page);
  const { cookie } = await seedPreviewSession(
    "client-brands",
    ({ db, suffix, userId }) => {
      seedPlan(db, seedWorkspace(db, suffix, userId), "agency");
    },
    { livePlan: false },
  );
  await signIn(page, baseURL, cookie);
  await page.goto("/app/settings");

  await expect(page.getByRole("heading", { level: 2, name: "Client brands" })).toBeVisible();
  await scanPage(page, testInfo, quality, `/app/settings client brands ${testInfo.project.name}`, {
    screen: /^settings$/i,
    keyboard: true,
  });

  const field = page.getByLabel("Add a client brand");
  await field.focus();
  await page.keyboard.type("Acme Foods");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/onboarding$/);
  const back = page.getByRole("button", { name: /^Back to / });
  await expect(back).toBeVisible();
  await back.focus();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/app$/);
  await page.goto("/app/settings");
  await expect(page.getByText("Viewing now")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^Open Acme/ })).toBeVisible();
});

test("client brands and the way back reflow at 320px and 640px", async ({ page, baseURL }) => {
  const { cookie } = await seedPreviewSession(
    "client-brands-reflow",
    ({ db, suffix, userId }) => {
      seedPlan(db, seedWorkspace(db, suffix, userId), "agency");
    },
    { livePlan: false },
  );
  await signIn(page, baseURL, cookie);
  await page.goto("/app/settings");
  await page.getByLabel("Add a client brand").fill("A client brand with a rather long name that has to wrap");
  await page.getByRole("button", { name: "Add client brand" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  for (const width of [320, 640]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/onboarding");
    expect.soft(await hiddenOverflow(page), `/onboarding at ${String(width)}px wide`).toEqual([]);
    await page.getByRole("button", { name: /^Back to / }).click();
    await page.goto("/app/settings");
    expect.soft(await hiddenOverflow(page), `/app/settings at ${String(width)}px wide`).toEqual([]);
    await page.getByRole("button", { name: /^Open / }).click();
  }
});

test("a Starter owner is not offered client brands", async ({ page, baseURL }) => {
  const { cookie } = await seedPreviewSession(
    "client-brands-starter",
    ({ db, suffix, userId }) => {
      seedPlan(db, seedWorkspace(db, suffix, userId), "starter");
    },
    { livePlan: false },
  );
  await signIn(page, baseURL, cookie);
  await page.goto("/app/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Client brands" })).toHaveCount(0);
});
