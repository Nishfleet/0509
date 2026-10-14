import type { DatabaseSync } from "node:sqlite";

import { type Page, type TestInfo } from "@playwright/test";

import { isLocalLane, run, seedPreviewSession } from "./inbox";
import { SCHEMES, scanPage, seedCompetitor, seedWorkspace, signIn, startQuality } from "./quality";
import { seedRankedHomeSession } from "./ranked-home";
import { expect, test } from "./test";

test.skip(
  !isLocalLane(),
  "the preview Worker signs in through a seeded session; production has the dedicated journeys",
);

test.setTimeout(180_000);

const DAY_MS = 24 * 60 * 60 * 1000;

interface BillingState {
  name: string;
  status: string;
  trialing: number;
  periodEndDays: number;
  line: RegExp;
  button: string;
}

const BILLING_STATES: BillingState[] = [
  {
    name: "trial running",
    status: "active",
    trialing: 1,
    periodEndDays: 5,
    line: /Your trial ends on/,
    button: "Manage or cancel plan",
  },
  {
    name: "renewing",
    status: "active",
    trialing: 0,
    periodEndDays: 20,
    line: /It renews on/,
    button: "Manage or cancel plan",
  },
  {
    name: "cancelled, paid until the period ends",
    status: "cancelled",
    trialing: 0,
    periodEndDays: 5,
    line: /then it stops/,
    button: "Manage billing",
  },
  {
    name: "payment on hold",
    status: "on_hold",
    trialing: 0,
    periodEndDays: 5,
    line: /so it's paused/,
    button: "Update payment method",
  },
  {
    name: "payment failed",
    status: "failed",
    trialing: 0,
    periodEndDays: 5,
    line: /didn't go through/,
    button: "See billing history",
  },
  {
    name: "ended",
    status: "expired",
    trialing: 0,
    periodEndDays: -3,
    line: /Your paid plan ended on/,
    button: "See billing history",
  },
];

function seedBilledPlan(db: DatabaseSync, workspaceId: string, state: BillingState): void {
  run(
    db,
    "INSERT INTO plan (id, workspace_id, tier, status, trialing, provider_customer_id, provider_subscription_id, current_period_end, updated_at) VALUES (?, ?, 'starter', ?, ?, ?, ?, ?, '2026-10-12T00:00:00.000Z')",
    `plan-${workspaceId}`,
    workspaceId,
    state.status,
    state.trialing,
    `cus_${workspaceId}`,
    `sub_${workspaceId}`,
    new Date(Date.now() + state.periodEndDays * DAY_MS).toISOString(),
  );
}

async function scanBothSchemes(
  page: Page,
  testInfo: TestInfo,
  quality: Awaited<ReturnType<typeof startQuality>>,
  label: string,
): Promise<void> {
  for (const colorScheme of SCHEMES) {
    await page.emulateMedia({ colorScheme });
    await scanPage(page, testInfo, quality, `${label} ${colorScheme} ${testInfo.project.name}`, {
      keyboard: colorScheme === "light",
    });
  }
}

test("the competitors and plan steps of onboarding pass the quality checks", async ({ page, baseURL }, testInfo) => {
  const quality = await startQuality(page);
  const competitors = await seedPreviewSession(
    "quality-step-competitors",
    ({ db, suffix, userId }) => {
      const workspaceId = seedWorkspace(db, suffix, userId);
      seedCompetitor(db, suffix, workspaceId);
      run(db, "UPDATE onboarding_run SET watching_started_at = NULL WHERE workspace_id = ?", workspaceId);
    },
    { livePlan: false },
  );
  await signIn(page, baseURL, competitors.cookie);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/onboarding\/competitors$/);
  await expect(page.getByRole("list", { name: "Watching" })).toBeVisible();
  await scanBothSchemes(page, testInfo, quality, "/onboarding/competitors");

  await page.context().clearCookies();
  const plan = await seedPreviewSession(
    "quality-step-plan",
    ({ db, suffix, userId }) => {
      seedCompetitor(db, suffix, seedWorkspace(db, suffix, userId));
    },
    { livePlan: false },
  );
  await signIn(page, baseURL, plan.cookie);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/onboarding\/plan$/);
  await expect(page.getByRole("heading", { name: "Start your trial" })).toBeVisible();
  await scanBothSchemes(page, testInfo, quality, "/onboarding/plan");
});

for (const state of BILLING_STATES) {
  test(`settings, plan ${state.name}, passes the quality checks and says so`, async ({ page, baseURL }, testInfo) => {
    const quality = await startQuality(page);
    const { cookie } = await seedPreviewSession(
      "quality-billing",
      ({ db, suffix, userId }) => {
        const workspaceId = seedWorkspace(db, suffix, userId);
        seedCompetitor(db, suffix, workspaceId);
        seedBilledPlan(db, workspaceId, state);
      },
      { livePlan: false },
    );
    await signIn(page, baseURL, cookie);
    const response = await page.goto("/app/settings");
    expect(response?.status()).toBe(200);
    const plan = page.getByRole("region", { name: "Your plan" });
    await expect(plan).toContainText(state.line);
    await expect(plan.getByRole("button", { name: state.button })).toBeVisible();
    await scanBothSchemes(page, testInfo, quality, `/app/settings ${state.name}`);
  });
}

test("a refused delete and a refused add show their alert and pass the quality checks", async ({
  page,
  baseURL,
}, testInfo) => {
  const quality = await startQuality(page);
  const { cookie } = await seedPreviewSession("quality-refusals", ({ db, suffix, userId }) => {
    const workspaceId = seedWorkspace(db, suffix, userId);
    seedCompetitor(db, suffix, workspaceId);
  });
  await signIn(page, baseURL, cookie);

  await page.goto("/app/settings");
  await page.getByLabel(/^Type .* to confirm$/).fill("someone-else@example.com");
  await page.getByRole("button", { name: "Delete my account" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "doesn't match your email" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Delete your account" })).toBeVisible();
  await scanBothSchemes(page, testInfo, quality, "/app/settings delete refused");

  await page.goto("/app/competitors");
  await page.getByLabel("Add a competitor we missed").fill("not a website");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.locator("#add-competitor-error")).toBeVisible();
  await scanBothSchemes(page, testInfo, quality, "/app/competitors add refused");
});

test("the how this is ranked dialog opens, passes the quality checks and returns focus", async ({
  page,
  baseURL,
}, testInfo) => {
  const quality = await startQuality(page);
  await signIn(page, baseURL, await seedRankedHomeSession("quality-dialog"));
  await page.goto("/app");
  const trigger = page.getByRole("button", { name: "How this is ranked" });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  for (const colorScheme of SCHEMES) {
    await page.emulateMedia({ colorScheme });
    await scanPage(page, testInfo, quality, `how ranked dialog ${colorScheme} ${testInfo.project.name}`, {
      keyboard: false,
    });
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
