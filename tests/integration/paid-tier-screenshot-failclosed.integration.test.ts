import { describe, expect, it } from "vitest";

import {
  buildScreenshotRateQuery,
  mapScreenshotRateRows,
} from "../../scripts/canary-proof-screenshot-rate.mjs";
import { createProofCapture } from "~/lib/data/watchlist-proof.server";

import { appEnv, seedProofTarget, seedUser, seedWatchlist } from "./fixtures";

/**
 * Issue #3017 acceptance 3 (mechanical-fix rule): a regression test that a
 * succeeded capture on a PAID-TIER watchlist carries a screenshot artifact.
 *
 * The pipeline is fail-closed by construction (#1181 guard in
 * `createProofCapture`, `requireScreenshot: true` on both proof paths), and
 * the guard is tested plan-agnostically in tests/data.server.test.ts — but
 * the PAID-TIER intersection (the cohort the homepage "saves the screenshots"
 * promise is paid to honour, Scout/Starter/Agency) had no regression test
 * driving the REAL write path against real D1. This suite proves, on real
 * migrations:
 *
 *   (a) the fail-closed guard holds on the paid tier: `createProofCapture`
 *       REFUSES `status: 'succeeded'` without a screenshot artifact key
 *       (`proof_capture_succeeded_without_screenshot`) and no succeeded row
 *       is persisted — a paid-tier watchlist cannot silently produce a
 *       screenshot-less "success",
 *   (b) the carried artifact: a paid-tier succeeded capture persisted through
 *       the real write path carries `screenshot_artifact_key` + a recorded
 *       `plan_at_capture`, and the canary's paid-tier cohort query (the
 *       ≥90%-over-48h metric population) counts it as `with_shot`.
 *
 * A mocked D1 binding can neither run the real INSERT/guard path nor see the
 * `plan_at_capture` cohort semantics, so this lives in the workers project.
 */

const WINDOW_HOURS = 48;

/** created_at strictly inside the 48h window (well clear of the cutoff). */
function recency(hoursAgo: number) {
  return new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
}

/** A stable 32-hex artifact key that passes the proof-key validators. */
function hexKey(seed: string) {
  let hash = "";
  for (let i = 0; i < 32; i += 1) {
    hash += seed.charCodeAt(i % seed.length).toString(16).padStart(2, "0").slice(-1);
  }
  return `landing-pages/2026-09-11/${hash}.jpeg`;
}

describe("paid-tier watchlist succeeded captures carry a screenshot artifact (#3017)", () => {
  it("REFUSES a succeeded paid-tier capture without a screenshot key and persists no succeeded row", async () => {
    const userId = await seedUser();
    const watchlistId = await seedWatchlist(userId);
    const proofTargetId = await seedProofTarget(watchlistId);

    // The paid tier (plan_at_capture recorded) changes nothing about the
    // fail-closed contract: a "succeeded" capture without a screenshot
    // artifact key is refused outright.
    await expect(
      createProofCapture(appEnv, {
        proofTargetId,
        status: "succeeded",
        planAtCapture: "scout",
        extractorVersion: "test-v1",
        attemptedAt: recency(1),
        succeededAt: recency(1),
      }),
    ).rejects.toThrow(/proof_capture_succeeded_without_screenshot/);

    // The refusal must not leave a succeeded row behind (the exact row shape
    // that made the pre-#1181 aggregate read 19% with screenshots missing).
    const counts = await appEnv.DB!.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded
       FROM proof_capture
       WHERE proof_target_id = ?`,
    )
      .bind(proofTargetId)
      .first<{ total: number; succeeded: number | null }>();
    expect(counts?.total).toBe(0);
    expect(counts?.succeeded ?? 0).toBe(0);
  });

  it("a succeeded paid-tier capture carries the screenshot artifact and counts as with_shot in the paid-tier cohort", async () => {
    const userId = await seedUser();
    const watchlistId = await seedWatchlist(userId);
    const proofTargetId = await seedProofTarget(watchlistId);

    const screenshotKey = hexKey(proofTargetId);
    const id = await createProofCapture(appEnv, {
      proofTargetId,
      status: "succeeded",
      screenshotArtifactKey: screenshotKey,
      htmlArtifactKey: `${screenshotKey}.html`,
      planAtCapture: "starter",
      extractorVersion: "test-v1",
      attemptedAt: recency(1),
      succeededAt: recency(1),
    });

    const row = await appEnv.DB!.prepare(
      `SELECT status, screenshot_artifact_key, html_artifact_key, plan_at_capture, succeeded_at
       FROM proof_capture
       WHERE id = ?`,
    )
      .bind(id)
      .first<{
        status: string;
        screenshot_artifact_key: string | null;
        html_artifact_key: string | null;
        plan_at_capture: string | null;
        succeeded_at: string | null;
      }>();

    // The succeeded capture on the paid-tier watchlist carries the artifact.
    expect(row?.status).toBe("succeeded");
    expect(row?.screenshot_artifact_key).toBe(screenshotKey);
    expect(row?.html_artifact_key).toBe(`${screenshotKey}.html`);
    expect(row?.plan_at_capture).toBe("starter");
    expect(row?.succeeded_at).not.toBeNull();

    // The metric population the promise is paid to honour sees it: the
    // canary's paid-tier cohort query counts the capture as with_shot.
    const result = await appEnv.DB!.prepare(
      buildScreenshotRateQuery(WINDOW_HOURS, { cohort: "paid-tier" }),
    ).all();
    const buckets = mapScreenshotRateRows(
      result.results as Array<{ kind: string | null; total: number; with_shot: number }>,
    );
    expect(buckets.real.total).toBe(1);
    expect(buckets.real.withShot).toBe(1);
    expect(buckets.real.pct).toBe(100);
  });
});
