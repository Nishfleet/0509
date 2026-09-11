/**
 * Nightly sitemap-timeline cohort backfill (issue #1958, phase 2).
 *
 * Sibling of `sneaker-resale-backfill.server.ts` (issue #1946) and
 * `demo-brand-backfill.server.ts` (issue #1449): same `captureLandingPageSnapshot`
 * write path, same `INSERT OR IGNORE` semantics, same `requireScreenshot: true`
 * honesty contract. The cohort is the sitemap-listed timeline domain set from
 * phase 1 minus the static demo/sneaker-seed exclusions, filtered by the
 * `public_search` tier verdict — a listed domain without coverage stays off
 * the cohort, so its honest /timeline/:domain ledger is never overwritten by
 * a phantom row.
 *
 * Honesty contract: a row is only written from a real snapshot (headline, CTA,
 * price, artifacts); a failed capture is a per-domain `capture_failed`, never
 * a written row; row ids are deterministic per (domain, UTC day) with
 * `INSERT OR IGNORE`; per-domain failures never abort the other domains.
 * Evidence age surfaces via `stale=N` (no expiry gate, phase 1); the cohort
 * is bounded by `SITEMAP_TIMELINE_COHORT_CAP` (default 200) to bound nightly
 * Browser Run spend.
 */

import { buildLandingPageAnalysisFields } from "~/lib/analysis.server";
import { extractPriceTier } from "~/lib/landing-page-price-tier.server";
import { replaceAnalysisFields } from "~/lib/data/ads.server";
import { execute, queryOne } from "~/lib/data/d1.server";
import { jsonValue, nowIso } from "~/lib/data/helpers.server";
import type { AppEnv } from "~/lib/env.server";
import {
  startLandingPagePipelineVolumeInstrumentation,
} from "~/lib/cta-pipeline-stage-counts.server";
import {
  captureLandingPageSnapshot,
  type LandingPageCaptureFailureDetail,
} from "~/lib/landing-pages.server";
import type { LandingPagePipelineCounters } from "~/lib/landing-page-pipeline-instrumentation.server";
import type { LandingPageSnapshotData } from "~/lib/types";
import {
  canonicalizeSitemapTimelineDomain,
  deriveSitemapTimelineCohort,
  type SitemapTimelineCohortEntry,
  type SitemapTimelineTier,
} from "./sitemap-timeline-cohort";
import {
  getSitemapTimelineTierByDomain,
  loadSitemapTimelineCandidateDomains,
  sitemapTimelineExcludedDomains,
} from "./sitemap-timeline-cohort.server";

/**
 * Hard bound on the nightly Browser Run budget: at most this many sitemap
 * domains are captured per run, in sitemap first-seen order. A future
 * sitemap coverage explosion (thousands of indexable timeline domains) can
 * never blow the nightly spend past the cap. The cap slices the cohort
 * before per-domain processing.
 */
export const SITEMAP_TIMELINE_COHORT_CAP = 200;

export type SitemapTimelineBackfillStatus =
  | "captured"
  | "skipped_already_captured"
  | "capture_failed"
  | "error";

export interface SitemapTimelineBackfillDomainResult {
  domain: string;
  status: SitemapTimelineBackfillStatus;
  /** Row id when a row was written this run (`timeline-<domain>-<day>`). */
  snapshotId: string | null;
  /** The capture pipeline's failure reason code when the capture failed. */
  reasonCode: string | null;
  /** The canonical page URL the capture resolved to, when captured. */
  canonicalUrl: string | null;
  /** The capture's own timestamp (ISO 8601), when captured. */
  capturedAt: string | null;
  /** Short error name for unexpected per-domain failures. */
  error: string | null;
  /**
   * The cohort's tier counts for the domain, when the candidate was in the
   * cohort. Null when the tier lookup returned no row or `hasCoverage` was
   * `false` (the candidate never entered the cohort).
   */
  tier: SitemapTimelineTier | null;
}

export interface SitemapTimelineBackfillResult {
  day: string;
  startedAt: string;
  /** Empty when no sitemap candidate survived the coverage filter. */
  domains: SitemapTimelineBackfillDomainResult[];
  capturedCount: number;
  failedCount: number;
}

/**
 * Function signature for the D1 tier lookup. The default path is
 * `getSitemapTimelineTierByDomain` from phase 1's
 * `app/lib/sitemap-timeline-cohort.server.ts`; tests inject a fixture so they
 * do not need to populate the `discovery_cache_entry` table.
 */
export type SitemapTimelineTierLookup = (
  env: AppEnv,
  domains: readonly string[],
) => Promise<Map<string, SitemapTimelineTier>>;

export interface SitemapTimelineBackfillOptions {
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
   * Tier-lookup override for tests. Defaults to
   * `getSitemapTimelineTierByDomain` (the phase-1 read-only D1 adapter).
   * Tests use this to inject a fixture tier map without populating the
   * `discovery_cache_entry` table.
   */
  tierLookup?: SitemapTimelineTierLookup;
  /**
   * Exclusion-set override for tests. Defaults to
   * `sitemapTimelineExcludedDomains()` (the real static demo ∪ sneaker-seed
   * set). Tests inject a fixture set to pin the exclusion contract without
   * depending on the bundled seed lists.
   */
  excludedDomains?: ReadonlySet<string> | readonly string[];
  /**
   * Cohort override for tests. Defaults to deriving the cohort from the
   * sitemap candidate domains and the tier map. Tests use this to pin the
   * domain set without going through the sitemap read / D1 lookup.
   */
  cohort?: readonly SitemapTimelineCohortEntry[];
  /**
   * Subset of the bounded cohort to capture. Used by catch-up-style callers
   * to process only specific sitemap domains. The `SITEMAP_TIMELINE_COHORT_CAP`
   * bound still applies before this filter — a requested domain beyond the
   * cap is never processed.
   */
  domains?: readonly string[];
}

/**
 * CAPTURE_HOMEPAGE = `https://www.<domain>/` — the same shape the sneaker
 * rail captures and the same shape the sitemap domain derivation accepts
 * (registrable domain from hostname), so a written row immediately qualifies
 * as a complete-proof sitemap candidate on the next read.
 */
function sitemapTimelineHomepage(domain: string): string {
  return `https://www.${domain}/`;
}

/**
 * A missing `landing_page_snapshot` table is an environment-level degrade
 * (the table ships with the repo's migrations; every real D1 has it). The
 * run bails to an empty degraded result instead of marking every cohort
 * domain as a per-domain `error` failure.
 */
function isMissingSnapshotTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  return (
    lowered.includes("no such table") && message.includes("landing_page_snapshot")
  );
}

/** `timeline-<domain>-<YYYY-MM-DD>` — deterministic per (domain, UTC day). */
export function sitemapTimelineBackfillRowId(
  domain: string,
  day: string,
): string {
  return `timeline-${domain}-${day}`;
}

/**
 * Derive the cohort from the sitemap-listed candidate domains and the
 * discovery-cache tier map. Pure except for the supplied `tierLookup` (a
 * function, injected or default) and the candidate-domain read. Returns `[]`
 * when the sitemap read returns no candidates, when every candidate is
 * excluded, or when no candidate has `hasCoverage: true`. When
 * `options.cohort` is supplied, it is used verbatim — tests inject
 * pre-derived cohorts to bypass the sitemap read / tier lookup.
 */
async function buildSitemapTimelineCohort(
  env: AppEnv,
  options: SitemapTimelineBackfillOptions,
): Promise<SitemapTimelineCohortEntry[]> {
  if (options.cohort) {
    return [...options.cohort];
  }
  const candidateDomains = await loadSitemapTimelineCandidateDomains(env);
  if (candidateDomains.length === 0) {
    return [];
  }
  const excludedDomains =
    options.excludedDomains ?? sitemapTimelineExcludedDomains();
  const tierLookup = options.tierLookup ?? getSitemapTimelineTierByDomain;
  const tierByDomain = await tierLookup(env, candidateDomains);
  return deriveSitemapTimelineCohort(candidateDomains, tierByDomain, excludedDomains);
}

/**
 * Run one nightly capture pass over the sitemap-timeline cohort. Each
 * sitemap-listed domain gets at most one row per UTC day (idempotent). Safe
 * under missing D1: returns an empty degraded result instead of throwing.
 * Safe under an empty candidate set or an empty cohort (no sitemap domains,
 * all excluded, none with verified/likely coverage): same empty degraded
 * result.
 */
export async function runSitemapTimelineBackfill(
  env: AppEnv,
  options: SitemapTimelineBackfillOptions = {},
): Promise<SitemapTimelineBackfillResult> {
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

  const cohort = await buildSitemapTimelineCohort(env, options);
  if (cohort.length === 0) {
    return {
      day,
      startedAt,
      domains: [],
      capturedCount: 0,
      failedCount: 0,
    };
  }

  const tierByDomain = new Map(cohort.map((entry) => [entry.domain, entry.tier]));
  const requested = options.domains
    ? new Set(
        options.domains
          .map((d) => canonicalizeSitemapTimelineDomain(d))
          .filter((d): d is string => Boolean(d)),
      )
    : null;

  const results: SitemapTimelineBackfillDomainResult[] = [];
  // The CAP slices the derived cohort first: Browser Run spend is bounded no
  // matter how large the sitemap candidacy grows, and a `domains` subset
  // cannot push past the cap either.
  for (const entry of cohort.slice(0, SITEMAP_TIMELINE_COHORT_CAP)) {
    if (requested && !requested.has(entry.domain)) {
      continue;
    }
    const rowId = sitemapTimelineBackfillRowId(entry.domain, day);
    try {
      const existing = await queryOne<{ id: string }>(
        env,
        "SELECT id FROM landing_page_snapshot WHERE id = ?",
        rowId,
      );
      if (existing) {
        results.push({
          domain: entry.domain,
          status: "skipped_already_captured",
          snapshotId: existing.id,
          reasonCode: null,
          canonicalUrl: null,
          capturedAt: null,
          error: null,
          tier: tierByDomain.get(entry.domain) ?? null,
        });
        continue;
      }

      let reasonCode: string | null = null;
      // Issue #2077: instrument each capture so cta_pipeline_stage_counts
      // fills for the backfill volume path.
      const instr = startLandingPagePipelineVolumeInstrumentation({
        watchlistId: "sitemap_timeline_backfill",
        scanId: rowId,
        adId: null,
      });
      let snapshot: LandingPageSnapshotData | null = null;
      try {
        snapshot = await capture(env, sitemapTimelineHomepage(entry.domain), {
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
        results.push({
          domain: entry.domain,
          status: "capture_failed",
          snapshotId: null,
          reasonCode,
          canonicalUrl: null,
          capturedAt: null,
          error: null,
          tier: tierByDomain.get(entry.domain) ?? null,
        });
        continue;
      }

      // INSERT OR IGNORE keeps the deterministic id the single source of
      // truth against an overlapping cron retry — for the analysis write
      // as well as the row: an ignored insert means a concurrent pass
      // already owns this row.
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
            price_tier,
            captured_at,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
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
        extractPriceTier(snapshot.priceText),
        snapshot.capturedAt,
        nowIso(),
      );
      if (Number(inserted.meta?.changes ?? 0) === 0) {
        // The concurrent winner's row and analysis fields are authoritative;
        // report the skip, not a capture this pass did not write.
        results.push({
          domain: entry.domain,
          status: "skipped_already_captured",
          snapshotId: rowId,
          reasonCode: null,
          canonicalUrl: null,
          capturedAt: null,
          error: null,
          tier: tierByDomain.get(entry.domain) ?? null,
        });
        continue;
      }
      await replaceAnalysisFields(
        env,
        "landing_page",
        rowId,
        buildLandingPageAnalysisFields(snapshot),
      );

      results.push({
        domain: entry.domain,
        status: "captured",
        snapshotId: rowId,
        reasonCode: null,
        canonicalUrl: snapshot.canonicalUrl,
        capturedAt: snapshot.capturedAt,
        error: null,
        tier: tierByDomain.get(entry.domain) ?? null,
      });
    } catch (error) {
      // Missing snapshot table → empty degraded result, never a throw
      // (plan phase 2: same degrade-don't-throw contract as the no-DB and
      // empty-cohort paths).
      if (isMissingSnapshotTableError(error)) {
        return {
          day,
          startedAt,
          domains: [],
          capturedCount: 0,
          failedCount: 0,
        };
      }
      results.push({
        domain: entry.domain,
        status: "error",
        snapshotId: null,
        reasonCode: null,
        canonicalUrl: null,
        capturedAt: null,
        error: error instanceof Error ? error.name : "UnknownError",
        tier: tierByDomain.get(entry.domain) ?? null,
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
 * Short human line used by the scheduled handler for its completion log.
 * `stale=N` surfaces evidence age (phase-1 reviewer carry-forward): the
 * number of processed domains whose tier verdict came from a cached row with
 * `expires_at` already past at read time — ops can see from the log how old
 * the discovery-cache evidence backing the captures was.
 */
export function summarizeSitemapTimelineBackfill(
  result: SitemapTimelineBackfillResult,
): string {
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
  const staleCount = result.domains.filter(
    (r) => r.tier?.cacheStatus === "stale",
  ).length;
  return `sitemap-timeline-backfill day=${result.day} cohort=${result.domains.length} captured=${result.capturedCount} failed=${result.failedCount} stale=${staleCount} [${lines.join(" ")}]`;
}