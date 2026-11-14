import type { DatabaseSync } from "node:sqlite";

import { type Page } from "@playwright/test";
import { expect, test } from "./test";

import { consoleFailures, isLocalLane, run, seedPreviewSession, watchConsole } from "./inbox";

test.skip(
  !isLocalLane(),
  "the preview Worker signs in through a seeded session; production walks the real onboarding in j3-onboard-domain.spec.ts",
);

const STAMP = "2026-10-12T00:00:00.000Z";

function seedWorkspace(db: DatabaseSync, suffix: string, userId: string, name: string): string {
  const workspaceId = `ws-${suffix}`;
  run(
    db,
    "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
    workspaceId,
    name,
    userId,
    STAMP,
  );
  return workspaceId;
}

function seedSelf(db: DatabaseSync, suffix: string, workspaceId: string): void {
  run(
    db,
    "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'self', ?, 'Self Brand', ?)",
    `ent-self-${suffix}`,
    workspaceId,
    `self-${suffix}.example`,
    STAMP,
  );
}

function seedCompetitors(db: DatabaseSync, suffix: string, workspaceId: string, userId: string): void {
  seedSelf(db, suffix, workspaceId);
  run(
    db,
    "INSERT INTO onboarding_run (id, workspace_id, user_id, input_raw, started_at) VALUES (?, ?, ?, 'self.example', ?)",
    `run-${suffix}`,
    workspaceId,
    userId,
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
    "INSERT INTO suggestion (id, workspace_id, kind, candidate_domain, candidate_name, verdict_p, verdict_reason, status, created_at) VALUES (?, ?, 'add', ?, 'Northloop', 0.7, 'Sells the same running kit to the same buyers.', 'pending', ?)",
    `sug-${suffix}`,
    workspaceId,
    `northloop-${suffix}.example`,
    STAMP,
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

async function horizontalOverflow(page: Page): Promise<number> {
  return await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test("a new account lands on the one input and an empty answer is refused", async ({ page, baseURL }, testInfo) => {
  const { cookie } = await seedPreviewSession(
    "onboarding-input",
    ({ db, suffix, userId }) => {
      seedWorkspace(db, suffix, userId, "Onboarding Input");
    },
    { livePlan: false },
  );
  await signIn(page, baseURL, cookie);
  const watched = watchConsole(page);

  await page.goto("/app");
  await expect(page).toHaveURL(/\/onboarding$/);
  const input = page.getByRole("textbox", { name: /your website address or social username/i });
  await expect(input).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  await expect(page.getByText(/^Signed in as onboarding-input-/)).toBeVisible();
  expect(await horizontalOverflow(page)).toBe(0);

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByText("We couldn't find a website or username in that.")).toBeVisible();
  await expect(input).toBeVisible();
  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});

test("opening the check-details step with no address sends a new account back to the one input", async ({
  page,
  baseURL,
}) => {
  const { cookie } = await seedPreviewSession(
    "onboarding-identity-bare",
    ({ db, suffix, userId }) => {
      seedWorkspace(db, suffix, userId, "Onboarding Bare");
    },
    { livePlan: false },
  );
  await signIn(page, baseURL, cookie);
  await page.goto("/onboarding/identity");
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByText("We couldn't find a website or username in that.")).toHaveCount(0);
});

test("the competitors step lists who is watched and who is a maybe, then moves on to the plan", async ({
  page,
  baseURL,
}, testInfo) => {
  const { cookie } = await seedPreviewSession(
    "onboarding-competitors",
    ({ db, suffix, userId }) => {
      const workspaceId = seedWorkspace(db, suffix, userId, "Onboarding Competitors");
      seedCompetitors(db, suffix, workspaceId, userId);
    },
    { livePlan: false },
  );
  await signIn(page, baseURL, cookie);
  const watched = watchConsole(page);

  await page.goto("/app");
  await expect(page).toHaveURL(/\/onboarding\/competitors$/);
  const watching = page.getByRole("list", { name: "Watching" });
  await expect(watching.getByRole("listitem")).toHaveCount(1);
  await expect(watching).toContainText("Zephyrwear");
  await expect(page.getByText("Northloop", { exact: true })).toBeVisible();
  await expect(page.getByText("Sells the same running kit to the same buyers.")).toBeVisible();
  await expect(page.getByText(/\b0\.7\b|\b70\s?%/)).toHaveCount(0);
  await expect(page.getByText(/Next you'll choose a plan and start your 7-day trial\./)).toBeVisible();
  expect(await horizontalOverflow(page)).toBe(0);

  await page.getByRole("button", { name: "Start watching" }).click();
  await expect(page).toHaveURL(/\/onboarding\/plan$/);
  await expect(page.getByRole("heading", { name: "Start your trial" })).toBeVisible();
  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});

test("the plan step offers every plan with the trial terms and says so when checkout is unavailable", async ({
  page,
  baseURL,
}, testInfo) => {
  const { cookie } = await seedPreviewSession(
    "onboarding-plan",
    ({ db, suffix, userId }) => {
      const workspaceId = seedWorkspace(db, suffix, userId, "Onboarding Plan");
      seedCompetitors(db, suffix, workspaceId, userId);
      run(db, "UPDATE onboarding_run SET watching_started_at = ? WHERE workspace_id = ?", STAMP, workspaceId);
    },
    { livePlan: false },
  );
  await signIn(page, baseURL, cookie);
  const watched = watchConsole(page);

  await page.goto("/app");
  await expect(page).toHaveURL(/\/onboarding\/plan$/);
  await expect(page.getByRole("heading", { name: "Start your trial" })).toBeVisible();
  const upgrades = page.getByRole("button", { name: /^Start 7-day \w+ trial/ });
  await expect(upgrades).toHaveCount(3);
  for (const plan of ["Scout", "Starter", "Agency"]) {
    await expect(page.getByRole("button", { name: new RegExp(`^Start 7-day ${plan} trial`) })).toBeVisible();
  }
  await expect(page.getByText(/Your first plan starts with a 7-day trial/)).toHaveCount(1);
  expect(await horizontalOverflow(page)).toBe(0);

  await upgrades.first().click();
  await expect(page.getByRole("alert").filter({ hasText: "Starting a trial isn't available right now" })).toBeVisible();
  await expect(page).toHaveURL(/\/onboarding\/plan/);
  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});

test("while checkout is being confirmed the plan step shows only Almost there, with no plan buttons", async ({
  page,
  baseURL,
}, testInfo) => {
  const { cookie } = await seedPreviewSession(
    "onboarding-confirming",
    ({ db, suffix, userId }) => {
      const workspaceId = seedWorkspace(db, suffix, userId, "Onboarding Confirming");
      seedCompetitors(db, suffix, workspaceId, userId);
      run(db, "UPDATE onboarding_run SET watching_started_at = ? WHERE workspace_id = ?", STAMP, workspaceId);
    },
    { livePlan: false },
  );
  await signIn(page, baseURL, cookie);
  const watched = watchConsole(page);

  await page.goto("/onboarding/plan?upgraded=agency");
  await expect(page.getByRole("heading", { name: "Almost there" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start your trial" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Start 7-day \w+ trial/ })).toHaveCount(0);
  expect(await horizontalOverflow(page)).toBe(0);
  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
