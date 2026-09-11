/**
 * Nightly demo-brand Offer Timeline backfill (issue #1449).
 *
 * The five flagship demo brands (nike, nykaa, allbirds, lenskart, mamaearth)
 * are indexed in sitemap.xml via their public `/ads/:domain` pages, but were
 * never watched by the monitoring pipeline — `landing_page_snapshot` carried
 * only the seeded backfill rows (migrations 0079/0081), which the proof gate
 * (issue #1284) filters out of the public ledger because they carry no
 * screenshot and no page-text artifact. `/timeline/:domain` therefore 410s
 * for every demo brand (issue #1309 retire path).
 *
 * This module is the nightly write path: it runs a REAL capture of each demo
 * brand homepage through the existing capture pipeline
 * (`captureLandingPageSnapshot`, the same function the monitoring watchlist
 * scans use) and persists one versioned `landing_page_snapshot` row per brand
 * per UTC day with both stored artifacts, so the row passes the proof gate
 * and the public timeline shows dated offer states with working screenshot
 * and page-text links.
 *
 * Honesty contract (same as migrations 0079/0081):
 *   * No fabricated data. A row is only written when the capture pipeline
 *     returned a real snapshot (headline, CTA, price, artifacts).
 *     `requireScreenshot: true` means a capture that could not produce a
 *     screenshot is treated as a per-brand failure, never a phantom offer.
 *   * Row ids are deterministic per (domain, UTC day) and inserts are
 *     `INSERT OR IGNORE`, so a cron retry cannot double-append a day.
 *   * capture_method is whatever the real pipeline reported
 *     (`browser_render` / `landing_page_fetch`) — never a seeded marker.
 *   * Per-brand failures are recorded and reported but never abort the other
 *     brands' captures.
 *
 * The module is deliberately small: it drives existing organs (capture
 * pipeline, D1 data layer, scheduled handler) and adds only its own
 * per-domain backoff state table (migration 0091, issue #2364).
 */

import { buildLandingPageAnalysisFields } from "~/lib/analysis.server";
import {
  createLandingPageSnapshot,
  landingPageSnapshotContentKey,
  replaceAnalysisFields,
} from "~/lib/data/ads.server";
import { execute, queryOne } from "~/lib/data/d1.server";
import { reportScheduledTaskFailure } from "~/lib/cron-failure-alert.server";
import { jsonValue, nowIso } from "~/lib/data/helpers.server";
import { DEMO_BRAND_PAGE_DOMAINS } from "~/lib/demo-brand-pages";
import type { AppEnv } from "~/lib/env.server";
import {
  startLandingPagePipelineVolumeInstrumentation,
} from "~/lib/cta-pipeline-stage-counts.server";
import {
  captureLandingPageSnapshot,
  type LandingPageCaptureFailureDetail,
} from "~/lib/landing-pages.server";
import { extractPriceTier } from "~/lib/landing-page-price-tier.server";
import { loadOfferTimeline } from "~/lib/offer-timeline.server";
import type { LandingPagePipelineCounters } from "~/lib/landing-page-pipeline-instrumentation.server";
import type { LandingPageSnapshotData } from "~/lib/types";

export type DemoBrandBackfillStatus =
  | "captured"
  | "skipped_already_captured"
  | "skipped_attempt_cap"
  | "stopped"
  | "skipped_stopped"
  | "capture_failed"
  | "error";

export interface DemoBrandBackfillDomainResult {
  domain: string;
  status: DemoBrandBackfillStatus;
  /** Row id when a row was written this run (`demo-<domain>-<day>`). */
  snapshotId: string | null;
  /** The capture pipeline's failure reason code when the capture failed. */
  reasonCode: string | null;
  /** The canonical page URL the capture resolved to, when captured. */
  canonicalUrl: string | null;
  /** The capture's own timestamp (ISO 8601), when captured. */
  capturedAt: string | null;
  /** Short error message for unexpected per-brand failures. */
  error: string | null;
}

export interface DemoBrandBackfillResult {
  day: string;
  startedAt: string;
  domains: DemoBrandBackfillDomainResult[];
  capturedCount: number;
  failedCount: number;
}

export interface DemoBrandBackfillOptions {
  /** UTC-day override for tests; defaults to the current time. */
  now?: Date;
  /**
   * Capture override for tests. Defaults to the real pipeline
   * (`captureLandingPageSnapshot`). Type matches the real function's shape.
   */
  capture?: (
    env: AppEnv,
    url: string,
    options: {
      preferRendered: boolean;
      requireScreenshot: boolean;
      routeContext: "proof_capture";
      onFailure: (detail: LandingPageCaptureFailureDetail) => void;
      instrumentation?: LandingPagePipelineCounters | null;
    },
  ) => Promise<LandingPageSnapshotData | null>;
  /**
   * Proof-hole probe override for tests. Defaults to the public timeline
   * loader (same gate as `/timeline/:domain`).
   */
  hasPublicProof?: (env: AppEnv, domain: string) => Promise<boolean>;
  /**
   * Subset of DEMO_BRAND_PAGE_DOMAINS to capture. The nightly rail omits
   * this (all five). Catch-up passes only the brands that still 410 so
   * a hole does not re-spend Browser Run minutes on brands that already
   * have public proof.
   */
  domains?: readonly string[];
}

export interface DemoBrandProofHoleCatchUpResult {
  skipped: boolean;
  missingDomains: string[];
  backfill: DemoBrandBackfillResult | null;
}

function demoBrandHomepage(domain: string): string {
  return `https://www.${domain}/`;
}

async function demoBrandHasPublicProof(env: AppEnv, domain: string): Promise<boolean> {
  const timeline = await loadOfferTimeline(env, { domain, asOf: null });
  return timeline.entries.length > 0;
}

/** `demo-<domain>-<YYYY-MM-DD>` — deterministic per (domain, UTC day). */
export function demoBackfillRowId(domain: string, day: string): string {
  return `demo-${domain}-${day}`;
}

/**
 * Max capture attempts per demo domain per UTC day (issue #2364). The hourly
 * proof-hole catch-up rides the gap-check rail (up to 24 passes/day); without
 * this cap a persistently blocked brand re-spends Browser Run minutes all day.
 */
export const DEMO_BRAND_MAX_ATTEMPTS_PER_DAY = 3;

/**
 * Consecutive fully-failed UTC days after which a demo domain stops capturing
 * (issue #2364). A day is "failed" when it had at least one attempt and every
 * attempt that day failed. On the third consecutive failed day the domain is
 * stopped and the worker routes one throttled operator alert.
 */
export const DEMO_BRAND_STOP_AFTER_FAILED_DAYS = 3;

/** Row shape for the `demo_brand_proof_hole_state` table (migration 0091). */
interface DemoBrandProofHoleStateRow {
  day: string;
  attempts_today: number;
  day_succeeded: number;
  consecutive_failed_days: number;
  stopped: number;
}

/**
 * The rolled-over, in-code view of a domain's proof-hole state for the current
 * UTC day, plus whether the stop threshold was crossed on this load.
 */
interface DemoBrandProofHoleState {
  attemptsToday: number;
  consecutiveFailedDays: number;
  stopped: boolean;
  /** True only on the run where the domain first crossed the stop threshold. */
  becameStopped: boolean;
}

/**
 * Read the per-domain proof-hole state and fast-forward it to the current UTC
 * day. On a day change it finalizes the previous day (failed-day verdict and
 * consecutive-failed-days streak) and resets the per-day attempt counters.
 * Never throws: it is the first gate in the per-domain loop, so a state-layer
 * failure should leave the domain to the normal capture path, not abort it.
 */
async function demoBrandProofHoleStateForToday(
  env: AppEnv,
  domain: string,
  today: string,
): Promise<DemoBrandProofHoleState> {
  // The read is the one gate that must never throw: under a rolled-back
  // schema (no demo_brand_proof_hole_state table) the domain must fall
  // through to the normal capture path, not abort the whole backfill.
  let existing: DemoBrandProofHoleStateRow | null = null;
  try {
    existing = await queryOne<DemoBrandProofHoleStateRow>(
      env,
      `SELECT day, attempts_today, day_succeeded, consecutive_failed_days, stopped
         FROM demo_brand_proof_hole_state WHERE domain = ?`,
      domain,
    );
  } catch {
    return {
      attemptsToday: 0,
      consecutiveFailedDays: 0,
      stopped: false,
      becameStopped: false,
    };
  }

  if (!existing) {
    try {
      await execute(
        env,
        `INSERT INTO demo_brand_proof_hole_state (
           domain, day, attempts_today, day_succeeded,
           consecutive_failed_days, stopped, updated_at
         ) VALUES (?, ?, 0, 0, 0, 0, ?)`,
        domain,
        today,
        nowIso(),
      );
    } catch {
      // Row creation is best-effort (see the guarded read comment above).
    }
    return {
      attemptsToday: 0,
      consecutiveFailedDays: 0,
      stopped: false,
      becameStopped: false,
    };
  }

  if (existing.day === today) {
    return {
      attemptsToday: existing.attempts_today,
      consecutiveFailedDays: existing.consecutive_failed_days,
      stopped: existing.stopped === 1,
      becameStopped: false,
    };
  }

  // UTC-day rollover: finalize the previous day.
  let consecutive = existing.consecutive_failed_days;
  if (existing.attempts_today > 0) {
    // A day with at least one attempt counts as failed only when every attempt
    // failed; any success resets the streak to zero.
    consecutive = existing.day_succeeded === 1 ? 0 : consecutive + 1;
  }
  const wasStopped = existing.stopped === 1;
  const stopped = wasStopped || consecutive >= DEMO_BRAND_STOP_AFTER_FAILED_DAYS;
  try {
    await execute(
      env,
      `UPDATE demo_brand_proof_hole_state
          SET day = ?, attempts_today = 0, day_succeeded = 0,
              consecutive_failed_days = ?, stopped = ?, updated_at = ?
        WHERE domain = ?`,
      today,
      consecutive,
      stopped ? 1 : 0,
      nowIso(),
      domain,
    );
  } catch {
    // Best-effort (see the guarded read comment above).
  }
  return {
    attemptsToday: 0,
    consecutiveFailedDays: consecutive,
    stopped,
    becameStopped: stopped && !wasStopped,
  };
}

/**
 * Record one capture attempt's outcome in the per-domain proof-hole state: bump
 * the today counter and mark the day as having a success when it succeeded. The
 * consecutive-failed-days streak is only updated at UTC-day rollover, so a day
 * that is still in flight is never counted early. Never throws into the cron.
 */
async function recordDemoBrandProofHoleAttempt(
  env: AppEnv,
  domain: string,
  day: string,
  succeeded: boolean,
): Promise<void> {
  try {
    await execute(
      env,
      `INSERT INTO demo_brand_proof_hole_state (
         domain, day, attempts_today, day_succeeded,
         consecutive_failed_days, stopped, updated_at
       ) VALUES (?, ?, 1, ?, 0, 0, ?)
       ON CONFLICT(domain) DO UPDATE SET
         day = excluded.day,
         attempts_today = attempts_today + 1,
         day_succeeded = MAX(day_succeeded, excluded.day_succeeded),
         updated_at = excluded.updated_at`,
      domain,
      day,
      succeeded ? 1 : 0,
      nowIso(),
    );
  } catch {
    // Best-effort state write; a failure to record must not break the capture.
  }
}

/**
 * Per-domain operator-alert task key for a stopped proof-hole domain. The
 * cron-failure alert throttle (`cron_failure_alert_throttle`, migration 0064)
 * dedupes on this key, so the stop email is emitted at most once per window
 * and never re-fires from a repeated `skipped_stopped` pass. `safeTaskKey`
 * admits only `[a-z0-9_-]{1,80}`, so the domain's dots are folded to `_`.
 */
function demoBrandProofHoleStopTaskKey(domain: string): string {
  return `demo_brand_proof_hole_stopped_${domain.replace(/[^a-z0-9_-]/g, "_")}`;
}

/**
 * Run one nightly capture pass over the five demo brands. Each brand gets at
 * most one row per UTC day (idempotent). Safe under missing D1: returns an
 * empty degraded result instead of throwing.
 */
export async function runDemoBrandBackfill(
  env: AppEnv,
  options: DemoBrandBackfillOptions = {},
): Promise<DemoBrandBackfillResult> {
  const now = options.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  const startedAt = now.toISOString();
  const capture = options.capture ?? captureLandingPageSnapshot;

  if (!env.DB) {
    return {
      day,
      startedAt,
      domains: [],
      capturedCount: 0,
      failedCount: 0,
    };
  }

  const results: DemoBrandBackfillDomainResult[] = [];
  const domains = options.domains ?? DEMO_BRAND_PAGE_DOMAINS;
  for (const domain of domains) {
    const rowId = demoBackfillRowId(domain, day);
    try {
      // Issue #2364: proof-hole backoff gate. State is per-domain in D1
      // (`demo_brand_proof_hole_state`, migration 0091); the first gate in the
      // loop cheaply rolls any UTC-day boundary forward and tells us whether
      // this domain is stopped or has already spent its daily attempt budget.
      const state = await demoBrandProofHoleStateForToday(env, domain, day);
      if (state.stopped) {
        // A domain that crossed the stop threshold emits exactly one throttled
        // operator email (becameStopped is true only on the transition run),
        // then reports `stopped`/`skipped_stopped` on every later pass and
        // never spends another Browser Run minute.
        if (state.becameStopped) {
          await reportScheduledTaskFailure(
            env,
            demoBrandProofHoleStopTaskKey(domain),
            new Error(
              `${domain}: demo brand proof hole persisted for ` +
                `${DEMO_BRAND_STOP_AFTER_FAILED_DAYS} consecutive failed days; ` +
                `capture stopped`,
            ),
          );
        }
        results.push({
          domain,
          status: state.becameStopped ? "stopped" : "skipped_stopped",
          snapshotId: null,
          reasonCode: null,
          canonicalUrl: null,
          capturedAt: null,
          error: null,
        });
        continue;
      }
      if (state.attemptsToday >= DEMO_BRAND_MAX_ATTEMPTS_PER_DAY) {
        results.push({
          domain,
          status: "skipped_attempt_cap",
          snapshotId: null,
          reasonCode: null,
          canonicalUrl: null,
          capturedAt: null,
          error: null,
        });
        continue;
      }
      const existing = await queryOne<{ id: string }>(
        env,
        "SELECT id FROM landing_page_snapshot WHERE id = ?",
        rowId,
      );
      if (existing) {
        results.push({
          domain,
          status: "skipped_already_captured",
          snapshotId: existing.id,
          reasonCode: null,
          canonicalUrl: null,
          capturedAt: null,
          error: null,
        });
        continue;
      }

      let reasonCode: string | null = null;
      // Issue #2077: instrument each capture so cta_pipeline_stage_counts
      // fills for the backfill volume path.
      const instr = startLandingPagePipelineVolumeInstrumentation({
        watchlistId: "demo_brand_backfill",
        scanId: rowId,
        adId: null,
      });
      let snapshot: LandingPageSnapshotData | null = null;
      try {
        snapshot = await capture(env, demoBrandHomepage(domain), {
          preferRendered: true,
          requireScreenshot: true,
          routeContext: "proof_capture",
          onFailure: (detail) => {
            reasonCode = detail.reasonCode;
          },
          instrumentation: instr.instrumentation,
        });
        instr.recordCaptureOutcome(snapshot, reasonCode);
      } finally {
        await instr.finish(env);
      }

      if (!snapshot) {
        await recordDemoBrandProofHoleAttempt(env, domain, day, false);
        results.push({
          domain,
          status: "capture_failed",
          snapshotId: null,
          reasonCode,
          canonicalUrl: null,
          capturedAt: null,
          error: null,
        });
        continue;
      }

      // INSERT OR IGNORE keeps the deterministic id the single source of
      // truth against an overlapping cron retry — for the analysis write
      // as well as the row: an ignored insert means a concurrent pass (the
      // nightly rail vs. the hourly catch-up) already owns this row. Issue
      // #2442: with the schema's content_key unique index, an ignored insert
      // may also be an identical capture persisted under a different id, so
      // the conflict target is named explicitly and the skip path read-back
      // below resolves whichever row actually persisted.
      const inserted = await execute(
        env,
        `
          INSERT OR IGNORE INTO landing_page_snapshot (
            id,
            raw_url,
            canonical_url,
            raw_headline,
            normalized_headline,
            normalized_headline_hash,
            capture_method,
            artifact_key,
            metadata_json,
            cta_text,
            price_text,
            form_present,
            ocr_text,
            translated_text,
            captured_at,
            created_at,
            price_tier
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
          ON CONFLICT(content_key) DO NOTHING
        `,
        rowId,
        snapshot.rawUrl,
        snapshot.canonicalUrl,
        snapshot.rawHeadline,
        snapshot.normalizedHeadline,
        snapshot.normalizedHeadlineHash,
        snapshot.captureMethod,
        snapshot.artifactKey ?? null,
        jsonValue(snapshot.metadata ?? null),
        snapshot.ctaText ?? null,
        snapshot.priceText ?? null,
        typeof snapshot.formPresent === "boolean" ? (snapshot.formPresent ? 1 : 0) : null,
        snapshot.capturedAt,
        nowIso(),
        extractPriceTier(snapshot.priceText),
      );
      if (Number(inserted.meta?.changes ?? 0) === 0) {
        // The concurrent winner's row and analysis fields are authoritative.
        // The day still counts as a success (the hole is filled), but this
        // pass captured nothing — report the skip, not a fresh capture. The
        // read-back resolves whichever row actually persisted (ours, or the
        // identical capture that won the content_key race) so the reported
        // snapshotId always points at a real row.
        const persisted = await queryOne<{ id: string }>(
          env,
          `SELECT id FROM landing_page_snapshot WHERE id = ? OR content_key = ?
           ORDER BY (id = ?) DESC LIMIT 1`,
          rowId,
          landingPageSnapshotContentKey(snapshot),
          rowId,
        );
        if (!persisted) {
          throw new Error(`demo brand backfill snapshot for ${domain} was not persisted`);
        }
        await recordDemoBrandProofHoleAttempt(env, domain, day, true);
        results.push({
          domain,
          status: "skipped_already_captured",
          snapshotId: persisted.id,
          reasonCode: null,
          canonicalUrl: null,
          capturedAt: null,
          error: null,
        });
        continue;
      }
      await replaceAnalysisFields(
        env,
        "landing_page",
        rowId,
        buildLandingPageAnalysisFields(snapshot),
      );

      await recordDemoBrandProofHoleAttempt(env, domain, day, true);
      results.push({
        domain,
        status: "captured",
        snapshotId: rowId,
        reasonCode: null,
        canonicalUrl: snapshot.canonicalUrl,
        capturedAt: snapshot.capturedAt,
        error: null,
      });
    } catch (error) {
      results.push({
        domain,
        status: "error",
        snapshotId: null,
        reasonCode: null,
        canonicalUrl: null,
        capturedAt: null,
        error: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  return {
    day,
    startedAt,
    domains: results,
    capturedCount: results.filter((r) => r.status === "captured").length,
    failedCount: results.filter(
      (r) => r.status === "capture_failed" || r.status === "error",
    ).length,
  };
}

/**
 * Hourly proof-hole catch-up (issue #1919). The nightly 04:00 rail is the
 * corpus-growth path; this function only fires a capture pass when at least
 * one demo brand still has zero public-timeline entries (the 410 case).
 * After every brand has a proof-bearing row, subsequent ticks are a cheap
 * D1 read and do not spend Browser Run minutes.
 */
export async function runDemoBrandProofHoleCatchUp(
  env: AppEnv,
  options: DemoBrandBackfillOptions = {},
): Promise<DemoBrandProofHoleCatchUpResult> {
  const hasPublicProof = options.hasPublicProof ?? demoBrandHasPublicProof;
  const missingDomains: string[] = [];
  for (const domain of DEMO_BRAND_PAGE_DOMAINS) {
    if (!(await hasPublicProof(env, domain))) {
      missingDomains.push(domain);
    }
  }
  if (missingDomains.length === 0) {
    return { skipped: true, missingDomains: [], backfill: null };
  }
  const backfill = await runDemoBrandBackfill(env, {
    ...options,
    domains: missingDomains,
  });
  return { skipped: false, missingDomains, backfill };
}

/** Short human line used by the scheduled handler for its completion log. */
export function summarizeDemoBrandBackfill(result: DemoBrandBackfillResult): string {
  const lines = result.domains.map((r) => {
    switch (r.status) {
      case "captured":
        return `${r.domain}:captured`;
      case "skipped_already_captured":
        return `${r.domain}:already`;
      case "skipped_attempt_cap":
        return `${r.domain}:capped`;
      case "stopped":
        return `${r.domain}:stopped`;
      case "skipped_stopped":
        return `${r.domain}:stopped-skip`;
      case "capture_failed":
        return `${r.domain}:failed${r.reasonCode ? `:${r.reasonCode}` : ""}`;
      case "error":
        return `${r.domain}:error${r.error ? `:${r.error}` : ""}`;
    }
  });
  return `demo-brand-backfill day=${result.day} captured=${result.capturedCount} failed=${result.failedCount} [${lines.join(" ")}]`;
}