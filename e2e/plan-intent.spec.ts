import type { DatabaseSync } from "node:sqlite";

import { expect, test } from "@playwright/test";

import { PLANS } from "../app/lib/billing/plans";
import { isLocalLane, run, seedPreviewSession } from "./inbox";

const STAMP = "2026-10-12T00:00:00.000Z";

function seedUnpaid({ db, suffix, userId }: { db: DatabaseSync; suffix: string; userId: string }): void {
  const workspaceId = `ws-${suffix}`;
  run(
    db,
    "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
    workspaceId,
    "Plan Intent",
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
    "INSERT INTO onboarding_run (id, workspace_id, user_id, input_raw, started_at, watching_started_at) VALUES (?, ?, ?, 'self.example', ?, ?)",
    `run-${suffix}`,
    workspaceId,
    userId,
    STAMP,
    STAMP,
  );
}

test("each plan on the pricing page starts sign-in with that plan", async ({ page }) => {
  await page.goto("/pricing");
  for (const { id, name } of PLANS) {
    await expect(page.getByRole("link", { name: `Start with ${name}` })).toHaveAttribute("href", `/login?plan=${id}`);
  }
});

test("a plan picked on the pricing page comes first on the plan step", async ({ page, baseURL, playwright }) => {
  test.skip(
    !isLocalLane(),
    "signs in through a seeded session on the preview Worker; production sign-in sends a real email",
  );
  const { cookie } = await seedPreviewSession("plan-intent", seedUnpaid, { livePlan: false });
  const origin = baseURL ?? "";
  await page.context().addCookies([
    ...cookie.split("; ").map((pair) => {
      const [name, ...value] = pair.split("=");
      return { name, value: value.join("="), url: origin };
    }),
  ]);

  await page.goto("/onboarding/plan");
  await expect(page.locator("[data-slot='picked-plan']")).toHaveCount(0);

  const visitor = await playwright.request.newContext({ baseURL });
  const response = await visitor.get("/login?plan=agency", { maxRedirects: 0 });
  const issued = /plan_intent=([^;]+)/.exec(response.headers()["set-cookie"] ?? "")?.[1];
  expect(issued).toBeDefined();
  const ignored = await visitor.get("/login?plan=bogus", { maxRedirects: 0 });
  expect(ignored.headers()["set-cookie"] ?? "").not.toContain("plan_intent=");
  await visitor.dispose();
  await page.context().addCookies([{ name: "plan_intent", value: issued ?? "", url: origin }]);

  await page.goto("/onboarding/plan");
  await expect(page.locator("[data-slot='picked-plan']")).toContainText("You picked Agency");
  await expect(page.getByRole("button", { name: /^Upgrade to/ }).first()).toContainText("Agency");
});
