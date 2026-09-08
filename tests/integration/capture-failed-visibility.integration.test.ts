import { describe, expect, it } from "vitest";

import { formatCaptureAttemptReasonLabel } from "~/lib/capture-attempt-reason-code";
import { listCaptureAttemptsForRun } from "~/lib/data/watchlist-run-capture-attempts.server";
import {
  CAPTURE_BUDGET_SKIP_HREF,
  CAPTURE_RULES_PUBLIC_PATH,
} from "~/lib/capture-validity-public-rules";

import { appEnv, ISO_T0, seedUser, seedWatchlist, seedRun, uid } from "./fixtures";

/**
 * Issue #1880 (Q9): every capture attempt that does not produce a `succeeded`
 * proof_capture row appears in `/app/watchlists/:id` run history with a
 * `capture_failed` (or `skipped_due_to_budget`) badge and a one-line reason.
 *
 * The run-history read path is `listCaptureAttemptsForRun` (the same function
 * the `/app/watchlists/:watchlistId` loader calls). This file asserts against
 * real D1 that a failed capture and a budget skip for one watchlist both
 * surface with a public status, a public reason code, and a human reason
 * label — and that the `failure_reason` column carries the failure text the
 * capture pipeline writes at capture time.
 *
 * Runs in the `workers` vitest project (real workerd + real local D1 with the
 * repo's migrations applied). The issue's verify command named
 * `tests/integration/capture-failed-visibility.test.ts` under `--project node`,
 * but the repo convention (AGENTS.md) is that real-D1 integration tests end in
 * `.integration.test.ts` and run under `--project workers`; a node-project
 * copy would mock the binding and prove nothing about the schema. This file
 * follows the repo convention.
 */

const RUN_START = "2026-08-25T10:00:00.000Z";
const RUN_END = "2026-08-25T10:05:00.000Z";

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

async function seedProofCapture(
  proofTargetId: string,
  input: {
    status: string;
    failureCode?: string | null;
    failureReason?: string | null;
    skipReason?: string | null;
    attemptedAt: string;
  },
  id = uid("pc"),
) {
  await appEnv.DB!.prepare(
    `INSERT INTO proof_capture (
       id, proof_target_id, status, skip_reason, failure_code, failure_reason,
       capture_metadata_json, extractor_version, attempted_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, '{}', 'v1', ?, ?, ?)`,
  )
    .bind(
      id,
      proofTargetId,
      input.status,
      input.skipReason ?? null,
      input.failureCode ?? null,
      input.failureReason ?? null,
      input.attemptedAt,
      input.attemptedAt,
      input.attemptedAt,
    )
    .run();
  return id;
}

describe("capture_failed visibility in run history (issue #1880)", () => {
  it("surfaces a failed capture and a budget skip with reasons for one watchlist", async () => {
    const userId = await seedUser();
    const watchlistId = await seedWatchlist(userId);
    await seedRun(watchlistId, { startedAt: RUN_START, status: "succeeded" });

    const failedTarget = await seedProofTargetWithUrl(
      watchlistId,
      "https://brand.example/offer",
    );
    const budgetTarget = await seedProofTargetWithUrl(
      watchlistId,
      "https://brand.example/checkout",
    );

    // A failed capture: the page served an anti-bot challenge. The capture
    // pipeline writes failure_code + failure_reason at capture time.
    await seedProofCapture(failedTarget, {
      status: "failed",
      failureCode: "landing_challenge_page",
      failureReason: "Cloudflare challenge served.",
      attemptedAt: "2026-08-25T10:01:00.000Z",
    });

    // A budget skip: the proof policy declined to spend a capture because the
    // plan allowance was exhausted. No screenshot is taken; the skip is
    // recorded with its reason.
    await seedProofCapture(budgetTarget, {
      status: "skipped_due_to_budget",
      skipReason: "skipped_due_to_budget",
      attemptedAt: "2026-08-25T10:02:00.000Z",
    });

    const attempts = await listCaptureAttemptsForRun(appEnv, {
      watchlistId,
      startedAt: RUN_START,
      finishedAt: RUN_END,
    });

    expect(attempts).toHaveLength(2);

    const byUrl = new Map(attempts.map((a) => [a.urlChecked, a]));

    const failed = byUrl.get("https://brand.example/offer")!;
    expect(failed.status).toBe("capture_failed");
    expect(failed.reasonCode).toBe("cloudflare_challenge");
    // failure_reason is populated at capture time and surfaces as errorMessage.
    expect(failed.errorMessage).toBe("Cloudflare challenge served.");
    // The public reason label is non-empty — the row never reads as a blank.
    expect(formatCaptureAttemptReasonLabel(failed.reasonCode)).toBe(
      "Anti-bot challenge wall",
    );

    const budget = byUrl.get("https://brand.example/checkout")!;
    expect(budget.status).toBe("skipped_due_to_budget");
    expect(budget.reasonCode).toBe("budget_skip");
    expect(formatCaptureAttemptReasonLabel(budget.reasonCode)).toBe(
      "Skipped — plan allowance reached",
    );
  });

  it("does not surface captures from a different watchlist", async () => {
    const userId = await seedUser();
    const watchlistId = await seedWatchlist(userId);
    const otherWatchlistId = await seedWatchlist(userId);
    await seedRun(watchlistId, { startedAt: RUN_START, status: "succeeded" });

    const ownTarget = await seedProofTargetWithUrl(
      watchlistId,
      "https://own.example",
    );
    const otherTarget = await seedProofTargetWithUrl(
      otherWatchlistId,
      "https://other.example",
    );

    await seedProofCapture(ownTarget, {
      status: "failed",
      failureCode: "landing_error_page",
      failureReason: "503 maintenance.",
      attemptedAt: "2026-08-25T10:01:00.000Z",
    });
    await seedProofCapture(otherTarget, {
      status: "failed",
      failureCode: "landing_error_page",
      failureReason: "503 maintenance.",
      attemptedAt: "2026-08-25T10:01:00.000Z",
    });

    const attempts = await listCaptureAttemptsForRun(appEnv, {
      watchlistId,
      startedAt: RUN_START,
      finishedAt: RUN_END,
    });

    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.urlChecked).toBe("https://own.example");
    expect(attempts[0]!.status).toBe("capture_failed");
  });

  it("links each non-success entry to the public capture-rules page", async () => {
    // The run-history UI (app.watchlists.$watchlistId.tsx) renders a "Learn
    // more" link per non-success row: capture_failed → the public rules page,
    // skipped_due_to_budget → the anchored budget-skip block. This asserts the
    // href constants the route imports resolve to the public page, so a buyer
    // who sees a failure has a one-click explanation (BET 4 output).
    expect(CAPTURE_RULES_PUBLIC_PATH).toBe("/capture-rules");
    expect(CAPTURE_BUDGET_SKIP_HREF).toBe("/capture-rules#budget-skip");
  });
});
