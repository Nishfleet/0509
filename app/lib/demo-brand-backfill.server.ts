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
 * pipeline, D1 data layer, scheduled handler) and adds no schema.
 */

import { buildLandingPageAnalysisFields } from "~/lib/analysis.server";
import {
  createLandingPageSnapshot,
  replaceAnalysisFields,
} from "~/lib/data/ads.server";
import { execute, queryOne } from "~/lib/data/d1.server";
import { jsonValue, nowIso } from "~/lib/data/helpers.server";
import { DEMO_BRAND_PAGE_DOMAINS } from "~/lib/demo-brand-pages";
import type { AppEnv } from "~/lib/env.server";
import {
  captureLandingPageSnapshot,
  type LandingPageCaptureFailureDetail,
} from "~/lib/landing-pages.server";
import type { LandingPageSnapshotData } from "~/lib/types";

export type DemoBrandBackfillStatus =
  | "captured"
  | "skipped_already_captured"
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
    },
  ) => Promise<LandingPageSnapshotData | null>;
}

function demoBrandHomepage(domain: string): string {
  return `https://www.${domain}/`;
}

/** `demo-<domain>-<YYYY-MM-DD>` — deterministic per (domain, UTC day). */
export function demoBackfillRowId(domain: string, day: string): string {
  return `demo-${domain}-${day}`;
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
  for (const domain of DEMO_BRAND_PAGE_DOMAINS) {
    const rowId = demoBackfillRowId(domain, day);
    try {
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
      const snapshot = await capture(env, demoBrandHomepage(domain), {
        preferRendered: true,
        requireScreenshot: true,
        routeContext: "proof_capture",
        onFailure: (detail) => {
          reasonCode = detail.reasonCode;
        },
      });

      if (!snapshot) {
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
      // truth against an overlapping cron retry.
      await execute(
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
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
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
      );
      await replaceAnalysisFields(
        env,
        "landing_page",
        rowId,
        buildLandingPageAnalysisFields(snapshot),
      );

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

/** Short human line used by the scheduled handler for its completion log. */
export function summarizeDemoBrandBackfill(result: DemoBrandBackfillResult): string {
  const lines = result.domains.map((r) => {
    switch (r.status) {
      case "captured":
        return `${r.domain}:captured`;
      case "skipped_already_captured":
        return `${r.domain}:already`;
      case "capture_failed":
        return `${r.domain}:failed${r.reasonCode ? `:${r.reasonCode}` : ""}`;
      case "error":
        return `${r.domain}:error${r.error ? `:${r.error}` : ""}`;
    }
  });
  return `demo-brand-backfill day=${result.day} captured=${result.capturedCount} failed=${result.failedCount} [${lines.join(" ")}]`;
}