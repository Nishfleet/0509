import { describe, expect, it } from "vitest";

import {
  buildScreenshotRateQuery,
  CANARY_KIND,
  mapScreenshotRateRows,
  TARGET_RATE_PCT,
  validateScreenshotRate,
} from "../../scripts/canary-proof-screenshot-rate.mjs";
import { env } from "cloudflare:workers";

import { seedProofTarget, seedUser, seedWatchlist, uid } from "./fixtures";

/**
 * Issue #1747 acceptance 2: a regression test that asserts the ≥90% screenshot
 * rate on NEW succeeded proof captures over a 48h window.
 *
 * The metric is D1-shaped ("≥90% of new succeeded proof_capture rows carry a
 * screenshot_artifact_key over a 48h window"), so this suite drives the REAL
 * migrations (per the repo workers-project convention) and runs the SAME
 * production aggregation query the canary ships (`buildScreenshotRateQuery`,
 * scripts/canary-proof-screenshot-rate.mjs) against real D1. It proves:
 *
 *   (a) a healthy watcher-capture population over a 48h window meets the ≥90%
 *       target, and the target is still met when the launch-gate captures whose
 *       keys are deliberately stripped by cleanup (kind =
 *       'launch_readiness_real_capture') are present — they are diagnostic only
 *       and must not drag the watcher rate below target (root cause #1327),
 *   (b) the aggregation honours the 48h window — captures older than the window
 *       are excluded and cannot dilute the rate,
 *   (c) the ≥90% target is a real boundary: 90% passes and 89% fails.
 *
 * A mocked D1 binding can neither see the real JSON `kind` split nor the
 * `datetime('now', ...)` window semantics, so this lives in the workers project.
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
  return `landing-pages/2026-09-05/${hash}.jpeg`;
}

interface CaptureSeed {
  proofTargetId: string;
  /** The JSON `kind` (null = real watcher capture). */
  kind: string | null;
  /** Whether the captured screenshot artifact key should be populated. */
  withScreenshot: boolean;
  created_at: string;
}

/**
 * Seeds a succeeded proof_capture row the way the pipeline persistence layer
 * would, so the row is a genuine `status='succeeded'` row with a real
 * `capture_metadata_json.kind` and (optionally) a real screenshot key.
 */
async function seedCapture(input: CaptureSeed): Promise<void> {
  const id = uid("pc");
  const captureMetadataJson = JSON.stringify(
    input.kind === null ? {} : { kind: input.kind },
  );
  await env.DB.prepare(
    `INSERT INTO proof_capture (
       id, proof_target_id, status, screenshot_artifact_key, html_artifact_key,
       capture_metadata_json, extractor_version, attempted_at, created_at, updated_at
     ) VALUES (?, ?, 'succeeded', ?, ?, ?, 'v1', ?, ?, ?)`,
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
    )
    .run();
}

/** Runs the production 48h window aggregation over real D1. */
async function windowBuckets() {
  const result = await env.DB.prepare(buildScreenshotRateQuery(WINDOW_HOURS)).all();
  return mapScreenshotRateRows(result.results as Array<{
    kind: string | null;
    total: number;
    with_shot: number;
  }>);
}

describe("proof screenshot rate target ≥90% over a 48h window (#1747)", () => {
  it("new watcher captures meet the target and launch-gate nulled keys do not dilute it", async () => {
    const userId = await seedUser();
    const watchlistId = await seedWatchlist(userId);
    const proofTargetId = await seedProofTarget(watchlistId);

    // A healthy watcher population: every REAL (kind null) succeeded capture is
    // fail-closed with a screenshot key, so the watcher rate is 100%.
    for (let i = 0; i < 20; i += 1) {
      await seedCapture({
        proofTargetId,
        kind: null,
        withScreenshot: true,
        created_at: recency(6),
      });
    }
    // Launch-gate captures whose keys are stripped by cleanup by design. They
    // must never drag the WATCHER rate below target.
    for (let i = 0; i < 90; i += 1) {
      await seedCapture({
        proofTargetId,
        kind: CANARY_KIND,
        withScreenshot: false,
        created_at: recency(6),
      });
    }

    const buckets = await windowBuckets();

    expect(buckets.real.total).toBeGreaterThanOrEqual(20);
    expect(buckets.real.pct).toBe(100);
    expect(buckets.real.pct).toBeGreaterThanOrEqual(TARGET_RATE_PCT);

    // The launch-gate nulled-key rows are diagnostic only — the real population
    // keeps >=90% while the aggregate (which counts those rows) may not.
    expect(buckets.canary.withShot).toBe(0);

    const validation = validateScreenshotRate({
      ...buckets,
      windowHours: WINDOW_HOURS,
      threshold: TARGET_RATE_PCT,
      minSample: 1,
    });
    expect(validation.verdict).toBe("pass");
  });

  it("honours the 48h window: captures older than the window are excluded", async () => {
    const userId = await seedUser();
    const watchlistId = await seedWatchlist(userId);
    const proofTargetId = await seedProofTarget(watchlistId);

    for (let i = 0; i < 20; i += 1) {
      await seedCapture({
        proofTargetId,
        kind: null,
        withScreenshot: true,
        created_at: recency(6),
      });
    }
    // Many screenshot-less succeeded captures from 72h ago must be OUTSIDE the
    // 48h window. They are ignored entirely, so the within-window rate stays
    // 100% (every counted row has a screenshot). If the window were not
    // honoured, these 200 no-key rows would drag the ratio well below target.
    for (let i = 0; i < 200; i += 1) {
      await seedCapture({
        proofTargetId,
        kind: null,
        withScreenshot: false,
        created_at: recency(72),
      });
    }

    const buckets = await windowBuckets();
    // Every within-window row carries a screenshot: no key-less row leaked in.
    expect(buckets.real.withShot).toBe(buckets.real.total);
    expect(buckets.real.total).toBeGreaterThanOrEqual(20);
    expect(buckets.real.pct).toBe(100);
    expect(buckets.real.pct).toBeGreaterThanOrEqual(TARGET_RATE_PCT);
  });

  it("the ≥90% target is a real boundary (90 passes, 89 fails)", () => {
    const base = {
      canary: { total: 0, withShot: 0, pct: 0 },
      all: { total: 0, withShot: 0, pct: 0 },
      windowHours: WINDOW_HOURS,
      threshold: TARGET_RATE_PCT,
      minSample: 1,
    };
    const atTarget = validateScreenshotRate({
      ...base,
      real: { total: 20, withShot: 18, pct: 90 },
    });
    expect(atTarget.verdict).toBe("pass");

    const belowTarget = validateScreenshotRate({
      ...base,
      real: { total: 100, withShot: 89, pct: 89 },
    });
    expect(belowTarget.verdict).toBe("fail");
    expect(belowTarget.failures[0]).toMatch(/dropped below 90%/);
  });
});

