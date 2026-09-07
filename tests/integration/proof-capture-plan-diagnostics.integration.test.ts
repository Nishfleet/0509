import { describe, expect, it } from "vitest";

import {
  buildScreenshotRateQuery,
  mapScreenshotRateRows,
  validateScreenshotRate,
  TARGET_RATE_PCT,
} from "../../scripts/canary-proof-screenshot-rate.mjs";
import { env } from "cloudflare:workers";

import { seedProofTarget, seedUser, seedWatchlist, uid } from "./fixtures";

/**
 * Issue #1876: the proof-capture screenshot-success metric must be measurable
 * on the PAID-TIER watchlist cohort (Scout/Starter/Agency), and the two new
 * additive columns (`plan_at_capture`, `capture_diagnostics`) must persist and
 * be readable after migration 0084.
 *
 * This suite drives the REAL migrations (per the repo workers-project
 * convention) so the assertions see the real schema, the new columns, and D1's
 * text/NULL semantics. It proves:
 *
 *   (a) WRITE path — a proof_capture row inserted with `plan_at_capture` and
 *       `capture_diagnostics` persists both, and they read back exactly,
 *   (b) READ path — the canary's paid-tier cohort query
 *       (`buildScreenshotRateQuery(window, {cohort:'paid-tier'})`) filters to
 *       `plan_at_capture IN ('scout','starter','agency')`: paid-tier succeeded
 *       captures with screenshots count toward the verdict, free-plan and
 *       unattributed (NULL plan) captures are excluded,
 *   (c) the ≥90% target holds for a healthy paid-tier cohort and the canary
 *       verdict is `pass`.
 *
 * A mocked D1 binding cannot see the new columns or the `plan_at_capture IN`
 * filter, so this lives in the workers project.
 */

const WINDOW_HOURS = 48;

/** created_at strictly inside the 48h window. */
function recency(hoursAgo: number) {
  return new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
}

/** A stable artifact key that passes the proof-key validators. */
function hexKey(seed: string) {
  let hash = "";
  for (let i = 0; i < 32; i += 1) {
    hash += seed.charCodeAt(i % seed.length).toString(16).padStart(2, "0").slice(-1);
  }
  return `landing-pages/2026-09-07/${hash}.jpeg`;
}

interface CaptureSeed {
  proofTargetId: string;
  /** The JSON `kind` (null = real watcher capture). */
  kind: string | null;
  /** Whether the captured screenshot artifact key should be populated. */
  withScreenshot: boolean;
  /** The watchlist owner's plan family at capture time (NULL = unattributed). */
  planAtCapture: string | null;
  /** Structured screenshot-missing diagnostic JSON (NULL for succeeded). */
  captureDiagnostics: string | null;
  created_at: string;
}

async function seedCapture(input: CaptureSeed): Promise<string> {
  const id = uid("pc");
  const captureMetadataJson = JSON.stringify(
    input.kind === null ? {} : { kind: input.kind },
  );
  await env.DB.prepare(
    `INSERT INTO proof_capture (
       id, proof_target_id, status, screenshot_artifact_key, html_artifact_key,
       capture_metadata_json, extractor_version, attempted_at, created_at,
       updated_at, plan_at_capture, capture_diagnostics
     ) VALUES (?, ?, 'succeeded', ?, ?, ?, 'v1', ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      input.proofTargetId,
      input.withScreenshot ? hexKey(id) : null,
      input.withScreenshot ? `${hexKey(id)}.html` : null,
      captureMetadataJson,
      input.created_at,
      input.created_at,
      input.created_at,
      input.planAtCapture,
      input.captureDiagnostics,
    )
    .run();
  return id;
}

/** Runs the production 48h paid-tier-cohort aggregation over real D1. */
async function paidTierBuckets() {
  const result = await env.DB.prepare(
    buildScreenshotRateQuery(WINDOW_HOURS, { cohort: "paid-tier" }),
  ).all();
  return mapScreenshotRateRows(result.results as Array<{
    kind: string | null;
    total: number;
    with_shot: number;
  }>);
}

describe("proof_capture plan_at_capture + capture_diagnostics (#1876)", () => {
  it("WRITE: persists plan_at_capture and capture_diagnostics and reads them back", async () => {
    const userId = await seedUser();
    const watchlistId = await seedWatchlist(userId);
    const proofTargetId = await seedProofTarget(watchlistId);

    // A succeeded paid-tier capture: plan recorded, no diagnostic (screenshot
    // present, fail-closed path).
    const succeededId = await seedCapture({
      proofTargetId,
      kind: null,
      withScreenshot: true,
      planAtCapture: "scout",
      captureDiagnostics: null,
      created_at: recency(3),
    });
    // A failed capture: plan recorded, structured screenshot-missing diagnostic.
    const failedId = uid("pc");
    const diagnosticsJson = JSON.stringify({
      screenshotMissingReason: "timeout",
      captureValidityStatus: "capture_failed",
    });
    await env.DB.prepare(
      `INSERT INTO proof_capture (
         id, proof_target_id, status, failure_code, failure_reason,
         capture_metadata_json, extractor_version, attempted_at, created_at,
         updated_at, plan_at_capture, capture_diagnostics
       ) VALUES (?, ?, 'failed', 'proof_capture_timeout', 'timed out', '{}', 'v1', ?, ?, ?, 'starter', ?)`,
    )
      .bind(failedId, proofTargetId, recency(2), recency(2), recency(2), diagnosticsJson)
      .run();

    const succeededRow = await env.DB.prepare(
      "SELECT plan_at_capture, capture_diagnostics FROM proof_capture WHERE id = ?",
    )
      .bind(succeededId)
      .first<{ plan_at_capture: string | null; capture_diagnostics: string | null }>();
    expect(succeededRow?.plan_at_capture).toBe("scout");
    expect(succeededRow?.capture_diagnostics).toBeNull();

    const failedRow = await env.DB.prepare(
      "SELECT plan_at_capture, capture_diagnostics FROM proof_capture WHERE id = ?",
    )
      .bind(failedId)
      .first<{ plan_at_capture: string | null; capture_diagnostics: string | null }>();
    expect(failedRow?.plan_at_capture).toBe("starter");
    expect(JSON.parse(failedRow?.capture_diagnostics ?? "{}")).toEqual({
      screenshotMissingReason: "timeout",
      captureValidityStatus: "capture_failed",
    });
  });

  it("READ: paid-tier cohort filters to scout/starter/agency and excludes free + unattributed", async () => {
    const userId = await seedUser();
    const watchlistId = await seedWatchlist(userId);
    const proofTargetId = await seedProofTarget(watchlistId);

    // 20 paid-tier (scout) succeeded captures, every one with a screenshot —
    // the healthy population the homepage promise is paid to honour.
    for (let i = 0; i < 20; i += 1) {
      await seedCapture({
        proofTargetId,
        kind: null,
        withScreenshot: true,
        planAtCapture: "scout",
        captureDiagnostics: null,
        created_at: recency(6),
      });
    }
    // 50 FREE-plan succeeded captures WITHOUT screenshots. These must be
    // EXCLUDED from the paid-tier cohort — if they leaked in they would drag
    // the rate to ~29% and fail the verdict.
    for (let i = 0; i < 50; i += 1) {
      await seedCapture({
        proofTargetId,
        kind: null,
        withScreenshot: false,
        planAtCapture: "free",
        captureDiagnostics: null,
        created_at: recency(6),
      });
    }
    // 50 UNATTRIBUTED (NULL plan_at_capture, e.g. legacy rows) succeeded
    // captures without screenshots. Also excluded from the paid-tier cohort.
    for (let i = 0; i < 50; i += 1) {
      await seedCapture({
        proofTargetId,
        kind: null,
        withScreenshot: false,
        planAtCapture: null,
        captureDiagnostics: null,
        created_at: recency(6),
      });
    }

    const buckets = await paidTierBuckets();

    // Only the 20 paid-tier captures are in the cohort; all carry a screenshot.
    expect(buckets.real.total).toBeGreaterThanOrEqual(20);
    expect(buckets.real.withShot).toBe(buckets.real.total);
    expect(buckets.real.pct).toBe(100);
    expect(buckets.real.pct).toBeGreaterThanOrEqual(TARGET_RATE_PCT);

    const validation = validateScreenshotRate({
      ...buckets,
      windowHours: WINDOW_HOURS,
      threshold: TARGET_RATE_PCT,
      minSample: 1,
    });
    expect(validation.verdict).toBe("pass");
  });

  it("READ: paid-tier cohort verdict fails when paid-tier captures lack screenshots", async () => {
    const userId = await seedUser();
    const watchlistId = await seedWatchlist(userId);
    const proofTargetId = await seedProofTarget(watchlistId);

    // 30 paid-tier (agency) succeeded captures, only 20 with a screenshot
    // → 66.7%, below the 90% target. Free-plan no-shot rows must NOT dilute
    // or rescue this number.
    for (let i = 0; i < 20; i += 1) {
      await seedCapture({
        proofTargetId,
        kind: null,
        withScreenshot: true,
        planAtCapture: "agency",
        captureDiagnostics: null,
        created_at: recency(6),
      });
    }
    for (let i = 0; i < 10; i += 1) {
      await seedCapture({
        proofTargetId,
        kind: null,
        withScreenshot: false,
        planAtCapture: "agency",
        captureDiagnostics: JSON.stringify({ screenshotMissingReason: "timeout" }),
        created_at: recency(6),
      });
    }
    for (let i = 0; i < 200; i += 1) {
      await seedCapture({
        proofTargetId,
        kind: null,
        withScreenshot: false,
        planAtCapture: "free",
        captureDiagnostics: null,
        created_at: recency(6),
      });
    }

    const buckets = await paidTierBuckets();
    expect(buckets.real.total).toBeGreaterThanOrEqual(30);
    expect(buckets.real.pct).toBeLessThan(TARGET_RATE_PCT);

    const validation = validateScreenshotRate({
      ...buckets,
      windowHours: WINDOW_HOURS,
      threshold: TARGET_RATE_PCT,
      minSample: 1,
    });
    expect(validation.verdict).toBe("fail");
  });
});
