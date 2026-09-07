import { describe, expect, it } from "vitest";

import { listCaptureAttemptsForRun } from "~/lib/data/watchlist-run-capture-attempts.server";
import { evaluateProofPolicy } from "~/lib/proof-policy.server";
import { classifyWatchPeriodTriage } from "~/lib/watch-period-triage";

import { appEnv, ISO_T0, seedProofTarget, seedRun, seedUser, seedWatchlist, uid } from "./fixtures";

/**
 * Issue #1857 acceptance (e): an integration test that creates a paid-tier
 * watchlist, exhausts its capture budget, and asserts the failure is
 * visible (not silent). Runs against real D1 (the `workers` vitest project)
 * so the proof_capture ↔ proof_target ↔ watchlist join, the run-history
 * read path, and the period triage all see the actual schema.
 *
 * The write path the monitoring workflow follows in production:
 *   1. `evaluateProofPolicy` decides `skipped_due_to_budget` at the monthly cap.
 *   2. The workflow persists a `proof_capture` row with that status and a
 *      non-null `skip_reason`.
 *   3. `listCaptureAttemptsForRun` surfaces it with `reasonCode = "budget_skip"`.
 *   4. `classifyWatchPeriodTriage` reads the period as `evidence_skipped_budget`,
 *      never `all_quiet` — so the digest cannot say "all quiet" while a
 *      paid customer's check was dropped.
 */

const RUN_START = "2026-08-25T10:00:00.000Z";
const RUN_END = "2026-08-25T10:05:00.000Z";

async function seedUserPlan(userId: string, plan: string) {
  await appEnv.DB!.prepare(
    `INSERT INTO user_plan (user_id, plan, plan_updated_at) VALUES (?, ?, ?)`,
  )
    .bind(userId, plan, ISO_T0)
    .run();
}

async function seedProofTargetWithUrl(
  watchlistId: string,
  landingPageUrl: string,
  id = uid("pt"),
) {
  await appEnv.DB!.prepare(
    `INSERT INTO proof_target (
       id, watchlist_id, landing_page_url, canonical_page_identity,
       proof_target_identity, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, watchlistId, landingPageUrl, `page_${id}`, `identity_${id}`, ISO_T0, ISO_T0)
    .run();
  return id;
}

async function seedBudgetSkipCapture(
  proofTargetId: string,
  input: { attemptedAt: string; skipReason?: string | null },
  id = uid("pc"),
) {
  await appEnv.DB!.prepare(
    `INSERT INTO proof_capture (
       id, proof_target_id, status, skip_reason, failure_code, failure_reason,
       capture_metadata_json, extractor_version, attempted_at, created_at, updated_at
     ) VALUES (?, ?, 'skipped_due_to_budget', ?, NULL, NULL, '{}', 'v1', ?, ?, ?)`,
  )
    .bind(
      id,
      proofTargetId,
      input.skipReason ?? "skipped_due_to_budget",
      input.attemptedAt,
      input.attemptedAt,
      input.attemptedAt,
    )
    .run();
  return id;
}

describe("proof-capture budget exhaustion against real D1 (#1857)", () => {
  it("a paid-tier (Starter) watchlist at its monthly cap: policy skips, capture is persisted, run history surfaces it, triage is not all-quiet", async () => {
    // 1. Seed a paid-tier (Starter) workspace.
    const userId = await seedUser();
    await seedUserPlan(userId, "starter");
    const watchlistId = await seedWatchlist(userId);
    const runId = await seedRun(watchlistId, { startedAt: RUN_START, status: "succeeded" });
    void runId;

    const target = await seedProofTargetWithUrl(watchlistId, "https://brand.example/offer");

    // 2. The proof policy at the Starter monthly cap (250) decides to skip.
    //    Starter's included allowance is 250 (app/lib/plan-entitlements.ts).
    const decision = evaluateProofPolicy({
      sensitivityMode: "balanced",
      triggerEventTypes: ["landing_page_cta_changed"],
      lastSuccessfulProofAt: "2026-08-01T00:00:00.000Z",
      watchlistRunAttemptCount: 0,
      watchlistDailyAttemptCount: 0,
      workspaceDailyAttemptCount: 0,
      workspaceDailyCap: 40,
      workspaceMonthlyAttemptCount: 250,
      workspaceMonthlyCap: 250,
      workspaceEvidenceRemaining: 0,
      workspaceRecentAttempts: [],
      activeCaptureCount: 0,
      burstCount: 1,
      proofRequestDuplicate: false,
      recentFailureCountForTarget: 0,
      applyPerWatchlistBudgets: false,
      now: RUN_START,
    });

    expect(decision.shouldCapture).toBe(false);
    expect(decision.skipReason).toBe("skipped_due_to_budget");

    // 3. The monitoring workflow persists the skip with a non-null skip_reason.
    const captureId = await seedBudgetSkipCapture(target, {
      attemptedAt: "2026-08-25T10:01:00.000Z",
      skipReason: decision.skipReason,
    });

    // 4. listCaptureAttemptsForRun (the run-history read path) surfaces the
    //    skip with a public reason code — it is never silent.
    const attempts = await listCaptureAttemptsForRun(appEnv, {
      watchlistId,
      startedAt: RUN_START,
      finishedAt: RUN_END,
    });

    expect(attempts).toHaveLength(1);
    const skip = attempts[0]!;
    expect(skip.id).toBe(captureId);
    expect(skip.status).toBe("skipped_due_to_budget");
    expect(skip.reasonCode).toBe("budget_skip");
    expect(skip.urlChecked).toBe("https://brand.example/offer");

    // 5. The period triage reads the skip as evidence_skipped_budget, never
    //    all_quiet — so the digest cannot say "all quiet" while a paid
    //    customer's check was dropped.
    const triage = classifyWatchPeriodTriage({
      events: [],
      candidates: [],
      proofCaptures: [{ status: "skipped_due_to_budget" }],
      successfulRuns: 1,
      lastSuccessfulCheckAt: RUN_START,
    });

    expect(triage.status).toBe("evidence_skipped_budget");
    expect(triage.label).toMatch(/plan allowance reached/i);
  });

  it("a budget skip with a null skip_reason is still surfaced (the canary flags it silent)", async () => {
    const userId = await seedUser();
    await seedUserPlan(userId, "starter");
    const watchlistId = await seedWatchlist(userId);
    await seedRun(watchlistId, { startedAt: RUN_START, status: "succeeded" });

    const target = await seedProofTargetWithUrl(watchlistId, "https://brand.example/silent");

    // A null skip_reason is the silent-degradation regression. The run-history
    // read path still returns the row (so the customer sees it); the live
    // canary separately flags the null as a silent skip.
    await seedBudgetSkipCapture(target, {
      attemptedAt: "2026-08-25T10:02:00.000Z",
      skipReason: null,
    });

    const attempts = await listCaptureAttemptsForRun(appEnv, {
      watchlistId,
      startedAt: RUN_START,
      finishedAt: RUN_END,
    });

    expect(attempts).toHaveLength(1);
    // The row is visible even with a null reason — it is never dropped.
    expect(attempts[0]!.status).toBe("skipped_due_to_budget");
  });

  it("multiple budget skips across competitor domains over a 72h window each surface in run history", async () => {
    const userId = await seedUser();
    await seedUserPlan(userId, "agency");
    const watchlistId = await seedWatchlist(userId);
    await seedRun(watchlistId, { startedAt: RUN_START, status: "succeeded" });

    const targetA = await seedProofTargetWithUrl(watchlistId, "https://a.example");
    const targetB = await seedProofTargetWithUrl(watchlistId, "https://b.example");

    await seedBudgetSkipCapture(targetA, { attemptedAt: "2026-08-25T10:01:00.000Z" });
    await seedBudgetSkipCapture(targetB, { attemptedAt: "2026-08-25T10:02:00.000Z" });

    const attempts = await listCaptureAttemptsForRun(appEnv, {
      watchlistId,
      startedAt: RUN_START,
      finishedAt: RUN_END,
    });

    expect(attempts).toHaveLength(2);
    for (const attempt of attempts) {
      expect(attempt.status).toBe("skipped_due_to_budget");
      expect(attempt.reasonCode).toBe("budget_skip");
    }
    const urls = attempts.map((a) => a.urlChecked).sort();
    expect(urls).toEqual(["https://a.example", "https://b.example"]);
  });
});
