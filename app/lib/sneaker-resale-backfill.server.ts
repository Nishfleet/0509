/**
 * Nightly sneaker-resale cohort Offer Timeline backfill (issue #1946, phase 2).
 *
 * Sibling module to `app/lib/demo-brand-backfill.server.ts` (issue #1449). Same
 * `captureLandingPageSnapshot` write path, same `INSERT OR IGNORE` semantics,
 * same `requireScreenshot: true` honesty contract — but the cohort is the
 * sneaker-resale cluster derived from `data/seed-lists/sneaker-resale.json`
 * AND the `public_search` discovery cache tier verdict produced by phase 1's
 * `app/lib/sneaker-resale-cohort.server.ts`. A brand whose cache has no
 * verified/likely coverage keeps the honest 410 shell from issue #1309 — no
 * phantom timeline row is ever written.
 *
 * Honesty contract (same shape as `runDemoBrandBackfill`):
 *   * No fabricated data. A row is only written when the capture pipeline
 *     returned a real snapshot (headline, CTA, price, artifacts). A capture
 *     that could not produce a screenshot is recorded as a per-brand
 *     `capture_failed` and never written to the table.
 *   * Row ids are deterministic per (domain, UTC day) and inserts are
 *     `INSERT OR IGNORE`, so a cron retry cannot double-append a day.
 *   * capture_method is whatever the real pipeline reported
 *     (`browser_render` / `landing_page_fetch`) — never a seeded marker.
 *   * Per-brand failures (capture pipeline returning null, unexpected
 *     exception) are recorded and reported but never abort the other brands'
 *     captures.
 *   * A brand whose discovery cache carries zero verified/likely ads is
 *     filtered out by `deriveSneakerResaleCohort` before this module ever
 *     calls `captureLandingPageSnapshot`, so a no-coverage seed list entry
 *     cannot produce a phantom row.
 *
 * The module is deliberately small: it drives existing organs (the capture
 * pipeline, D1 data layer, phase 1's cohort derivation) and adds no schema.
 * Phase 3 wires it onto the daily rail in `workers/app.ts`.
 */

import { resolveSeedList } from "~/lib/ads-domain-publisher.server";
import { buildLandingPageAnalysisFields } from "~/lib/analysis.server";
import { landingPageSnapshotContentKey, replaceAnalysisFields } from "~/lib/data/ads.server";
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
import { extractPriceTier } from "~/lib/landing-page-price-tier.server";
import { loadOfferTimeline } from "~/lib/offer-timeline.server";
import type { LandingPagePipelineCounters } from "~/lib/landing-page-pipeline-instrumentation.server";
import {
  canonicalizeSneakerResaleDomain,
  deriveSneakerResaleCohort,
  type SneakerResaleCohortEntry,
  type SneakerResaleTier,
} from "./sneaker-resale-cohort";
import { getSneakerResaleTierByDomain } from "./sneaker-resale-cohort.server";
import type { SeedList } from "~/lib/ads-domain-publisher.server";
import type { LandingPageSnapshotData } from "~/lib/types";

export const SNEAKER_RESALE_SEED_LIST = "sneaker-resale";

export type SneakerResaleBackfillStatus =
  | "captured"
  | "skipped_already_captured"
  | "capture_failed"
  | "error";

export interface SneakerResaleBackfillDomainResult {
  domain: string;
  status: SneakerResaleBackfillStatus;
  /** Row id when a row was written this run (`sneaker-<domain>-<day>`). */
  snapshotId: string | null;
  /** The capture pipeline's failure reason code when the capture failed. */
  reasonCode: string | null;
  /** The canonical page URL the capture resolved to, when captured. */
  canonicalUrl: string | null;
  /** The capture's own timestamp (ISO 8601), when captured. */
  capturedAt: string | null;
  /** Short error name for unexpected per-brand failures. */
  error: string | null;
  /**
   * The cohort's tier counts for the domain, when the brand was in the
   * cohort. Null when the seed list had no entry, when the cache lookup
   * returned no row, or when `hasCoverage` was `false`.
   */
  tier: SneakerResaleTier | null;
}

export interface SneakerResaleBackfillResult {
  day: string;
  startedAt: string;
  /** Empty when no brand in the cohort survived the discovery-cache filter. */
  domains: SneakerResaleBackfillDomainResult[];
  capturedCount: number;
  failedCount: number;
}

/**
 * Function signature for the D1 tier lookup. The default path is
 * `getSneakerResaleTierByDomain` from `app/lib/sneaker-resale-cohort.server.ts`;
 * tests inject a fixture so they do not need to populate the
 * `discovery_cache_entry` table.
 */
export type SneakerResaleTierLookup = (
  env: AppEnv,
  domains: readonly string[],
) => Promise<Map<string, SneakerResaleTier>>;

export interface SneakerResaleBackfillOptions {
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
   * Tier-lookup override for tests. Defaults to
   * `getSneakerResaleTierByDomain` (the phase-1 read-only D1 adapter).
   * Tests use this to inject a fixture tier map without populating the
   * `discovery_cache_entry` table.
   */
  tierLookup?: SneakerResaleTierLookup;
  /**
   * Cohort override for tests. Defaults to deriving the cohort from
   * `data/seed-lists/sneaker-resale.json` and the tier map. Tests use this
   * to pin the brand set without going through the seed list / D1 lookup.
   */
  cohort?: readonly SneakerResaleCohortEntry[];
  /**
   * Subset of the cohort to capture. The nightly rail omits this (full
   * cohort). Catch-up passes only the brands that still 410 so a hole does
   * not re-spend Browser Run minutes on brands that already have public
   * proof.
   */
  domains?: readonly string[];
}

export interface SneakerResaleProofHoleCatchUpResult {
  skipped: boolean;
  missingDomains: string[];
  backfill: SneakerResaleBackfillResult | null;
}

function sneakerResaleHomepage(domain: string): string {
  return `https://www.${domain}/`;
}

async function sneakerResaleHasPublicProof(
  env: AppEnv,
  domain: string,
): Promise<boolean> {
  const timeline = await loadOfferTimeline(env, { domain, asOf: null });
  return timeline.entries.length > 0;
}

/** `sneaker-<domain>-<YYYY-MM-DD>` — deterministic per (domain, UTC day). */
export function sneakerResaleBackfillRowId(
  domain: string,
  day: string,
): string {
  return `sneaker-${domain}-${day}`;
}

/**
 * Derive the cohort from the bundled seed list and the discovery-cache tier
 * map. Pure except for the supplied `tierLookup` (a function, injected or
 * default). Returns `[]` when the seed list is missing, malformed, or empty.
 * When `options.cohort` is supplied, it is used verbatim — tests inject
 * pre-derived cohorts to bypass the seed list / D1 lookup.
 */
async function buildSneakerResaleCohort(
  env: AppEnv,
  options: SneakerResaleBackfillOptions,
): Promise<SneakerResaleCohortEntry[]> {
  if (options.cohort) {
    return [...options.cohort];
  }
  const seedList = resolveSeedList(SNEAKER_RESALE_SEED_LIST);
  if (!seedList || !Array.isArray(seedList.domains) || seedList.domains.length === 0) {
    return [];
  }
  const seedDomains = seedList.domains
    .map((entry) => entry?.domain)
    .filter((domain): domain is string => typeof domain === "string" && domain.length > 0);
  if (seedDomains.length === 0) {
    return [];
  }
  const tierLookup = options.tierLookup ?? getSneakerResaleTierByDomain;
  const tierByDomain = await tierLookup(env, seedDomains);
  return deriveSneakerResaleCohort(seedList as SeedList, tierByDomain);
}

/**
 * Run one nightly capture pass over the sneaker-resale cohort. Each brand
 * gets at most one row per UTC day (idempotent). Safe under missing D1:
 * returns an empty degraded result instead of throwing. Safe under an empty
 * cohort (seed list missing, no brands with verified/likely coverage): same
 * empty degraded result.
 */
export async function runSneakerResaleBackfill(
  env: AppEnv,
  options: SneakerResaleBackfillOptions = {},
): Promise<SneakerResaleBackfillResult> {
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

  const cohort = await buildSneakerResaleCohort(env, options);
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
          .map((d) => canonicalizeSneakerResaleDomain(d))
          .filter((d): d is string => Boolean(d)),
      )
    : null;

  const results: SneakerResaleBackfillDomainResult[] = [];
  for (const entry of cohort) {
    if (requested && !requested.has(entry.domain)) {
      continue;
    }
    const rowId = sneakerResaleBackfillRowId(entry.domain, day);
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
        watchlistId: "sneaker_resale_backfill",
        scanId: rowId,
        adId: null,
      });
      let snapshot: LandingPageSnapshotData | null = null;
      try {
        snapshot = await capture(env, sneakerResaleHomepage(entry.domain), {
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
      // already owns this row. Issue #2442: with the schema's content_key
      // unique index, an ignored insert may also be an identical capture
      // persisted under a different id, so the conflict target is named
      // explicitly and the skip path read-back below resolves whichever row
      // actually persisted.
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
        // The concurrent winner's row and analysis fields are authoritative;
        // report the skip, not a capture this pass did not write. The
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
          throw new Error(`sneaker resale backfill snapshot for ${entry.domain} was not persisted`);
        }
        results.push({
          domain: entry.domain,
          status: "skipped_already_captured",
          snapshotId: persisted.id,
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
 * Hourly proof-hole catch-up (mirrors `runDemoBrandProofHoleCatchUp`).
 * The nightly 04:00 rail is the corpus-growth path; this function only fires
 * a capture pass when at least one cohort brand still has zero
 * public-timeline entries (the 410 case). After every covered brand has a
 * proof-bearing row, subsequent ticks are a cheap D1 read and do not spend
 * Browser Run minutes.
 */
export async function runSneakerResaleProofHoleCatchUp(
  env: AppEnv,
  options: SneakerResaleBackfillOptions = {},
): Promise<SneakerResaleProofHoleCatchUpResult> {
  if (!env.DB) {
    return { skipped: true, missingDomains: [], backfill: null };
  }

  const cohort = await buildSneakerResaleCohort(env, options);
  if (cohort.length === 0) {
    return { skipped: true, missingDomains: [], backfill: null };
  }

  const hasPublicProof = options.hasPublicProof ?? sneakerResaleHasPublicProof;
  const missingDomains: string[] = [];
  for (const entry of cohort) {
    if (!(await hasPublicProof(env, entry.domain))) {
      missingDomains.push(entry.domain);
    }
  }
  if (missingDomains.length === 0) {
    return { skipped: true, missingDomains: [], backfill: null };
  }
  const backfill = await runSneakerResaleBackfill(env, {
    ...options,
    domains: missingDomains,
  });
  return { skipped: false, missingDomains, backfill };
}

/** Short human line used by the scheduled handler for its completion log. */
export function summarizeSneakerResaleBackfill(
  result: SneakerResaleBackfillResult,
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
  return `sneaker-resale-backfill day=${result.day} cohort=${result.domains.length} captured=${result.capturedCount} failed=${result.failedCount} [${lines.join(" ")}]`;
}
