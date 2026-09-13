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
 *
 * Budget rails (issue #3357): the #1549 publisher hit exactly this rail's
 * failure mode — an unbounded nightly capture loop on the 04:00 rail whose
 * deterministic order serves the cohort HEAD every night while the 15-minute
 * Cloudflare scheduled wall kills the tail. Two #1549-shaped fixes, no new
 * mechanism:
 *   - an internal wall-clock deadline (SITEMAP_TIMELINE_BACKFILL_DEADLINE_MS)
 *     stops STARTING new captures and surfaces `truncated: true`, so the run
 *     reports its own cut instead of dying silently mid-capture; and
 *   - the cohort is captured STALEST-FIRST: this rail's OWN
 *     `timeline-<domain>-<day>` ledger rows are the resume cursor (the #1549
 *     persisted-cursor pattern, satisfied by the runtime-capture path itself
 *     — no new state, no D1 migration, issue #3357 acceptance 4). Within a
 *     few nights every cohort domain holds a proof-complete row, which is
 *     the #3095 coverage canary's documented observe-to-close (the
 *     ops/timeline-coverage-guard timer runs it daily, after this rail).
 * The #2873 capture-validity contract is unchanged: every row still comes
 * from a real `requireScreenshot` capture, and the read-side complete-proof
 * gate (snapshotRowHasCompleteProof) still suppresses phantom states.
 */

import { buildLandingPageAnalysisFields } from "~/lib/analysis.server";
import { extractPriceTier } from "~/lib/landing-page-price-tier.server";
import { landingPageSnapshotContentKey, replaceAnalysisFields } from "~/lib/data/ads.server";
import { execute, queryAll, queryOne } from "~/lib/data/d1.server";
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
 * domains are captured per run. Since issue #3357 the cohort is processed
 * stalest-#1958-capture first (see the module docblock), and the cap slices
 * the ORDERED cohort — the least-recently-captured domains are exactly the
 * ones the nightly spend keeps, ties in sitemap first-seen order. A future
 * sitemap coverage explosion (thousands of indexable timeline domains) can
 * never blow the nightly spend past the cap, and a strained budget now
 * delays the freshest domains, never the starved ones. The cap slices
 * before per-domain processing.
 */
export const SITEMAP_TIMELINE_COHORT_CAP = 200;

/**
 * Internal wall-clock deadline for one nightly run (issue #3357, the #1549
 * pattern). Cloudflare kills scheduled invocations at the 15-minute wall,
 * and this rail rides the 04:00 cron as one of several concurrent waitUntil
 * siblings — the #1549 publisher alone budgets 10 of those minutes. Like the
 * publisher, the loop stops STARTING new per-domain captures at this budget,
 * finishes the in-flight capture, and reports the run as `truncated: true`
 * so the cohort's remaining tail is provably tomorrow's work, never a
 * silently swallowed capture. 8 minutes leaves the shared 15-minute wall
 * real margin beside the publisher's own 10-minute budget.
 */
export const SITEMAP_TIMELINE_BACKFILL_DEADLINE_MS = 8 * 60 * 1000;

/**
 * How far back the staleness ledger looks (issue #3357). Rows written by
 * this rail (id LIKE 'timeline-%') more recently than this are honored when
 * ordering the cohort; anything older — or never captured — reads as
 * "stalest". 7 nights bounds the read at cohort-cap × 7 rows (≤ 1400) no
 * matter how long the ledger grows, and 7 nights is far beyond the cadence
 * at which the deadline budget cycles even a cap-sized cohort.
 */
export const SITEMAP_TIMELINE_CAPTURE_LEDGER_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Hard row bound on the ledger read itself (belt over the lookback window,
 * which already bounds it: cohort-cap × 7 nights). Keeps the nightly rail's
 * read cost constant even if a future writer reuses the `timeline-` id
 * prefix at scale.
 */
export const SITEMAP_TIMELINE_CAPTURE_LEDGER_READ_LIMIT = 5000;

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
 * Parse the deterministic row id back into its (domain, UTC day). Sibling of
 * `sitemapTimelineBackfillRowId` — the staleness ordering (issue #3357) reads
 * rows written by THIS rail and must recover the domain without guessing:
 * the day is the final `YYYY-MM-DD` segment, everything before it is the
 * canonical domain (dots and dashes included, e.g.
 * `timeline-boat-lifestyle.com-2026-09-13`). Returns `null` for anything
 * another writer wrote (demo-…/sneaker-…/backfill-…), so the ledger read
 * ignores other rails' rows by construction. Pure.
 */
export function parseSitemapTimelineBackfillRowId(
  id: unknown,
): { domain: string; day: string } | null {
  if (typeof id !== "string" || !id) {
    return null;
  }
  const match = /^timeline-(.+)-(\d{4}-\d{2}-\d{2})$/.exec(id);
  if (!match) {
    return null;
  }
  const domain = match[1];
  const day = match[2];
  if (!domain) {
    return null;
  }
  return { domain, day };
}

/**
 * Latest `timeline-<domain>-<day>` this rail wrote per domain, read from the
 * rail's own id space in ONE bounded D1 read (rows whose `captured_at` is
 * inside the 7-day lookback, `SITEMAP_TIMELINE_CAPTURE_LEDGER_READ_LIMIT`
 * cap). This IS the resume state: the ledger rows are the cursor (issue
 * #3357), so no extra state table, no migration. Honesty contract: a failed
 * or unexpected read degrades to an EMPTY map — the run then captures in
 * cohort (sitemap first-seen) order exactly as before this change — never
 * thrown, so a ledger hiccup can never zero the nightly capture. Rows whose
 * id does not parse are skipped, never guessed.
 */
export async function loadRecentSitemapTimelineCaptureDays(
  env: AppEnv,
  sinceIso: string,
): Promise<Map<string, string>> {
  const days = new Map<string, string>();
  if (!env?.DB) {
    return days;
  }
  try {
    const rows = await queryAll<{ id: string }>(
      env,
      `SELECT id FROM landing_page_snapshot
       WHERE id LIKE 'timeline-%' AND captured_at >= ?
       ORDER BY captured_at ASC
       LIMIT ${SITEMAP_TIMELINE_CAPTURE_LEDGER_READ_LIMIT}`,
      sinceIso,
    );
    for (const row of Array.isArray(rows) ? rows : []) {
      const parsed = parseSitemapTimelineBackfillRowId(row?.id);
      if (!parsed) {
        continue;
      }
      const previous = days.get(parsed.domain);
      if (!previous || parsed.day > previous) {
        days.set(parsed.domain, parsed.day);
      }
    }
  } catch {
    // Degrade, never throw: an unreadable ledger means an unordered cohort,
    // not a failed night (same degrade-don't-throw contract as the no-DB
    // and empty-cohort paths).
  }
  return days;
}

/**
 * Order the cohort so its LEAST-RECENTLY-#1958-captured domains go first
 * (issue #3357's starvation fix). A domain with no recent rail row — never
 * captured, or last captured outside the lookback — sorts before any
 * recently captured one; within a day bucket, orders ascend by that day
 * (fresher = later), and ties keep the cohort's sitemap first-seen order
 * (stable sort — the #1549 lesson: deterministic head-of-queue service is
 * exactly what starved the tail). Pure.
 */
export function orderSitemapTimelineCohortByCaptureStaleness(
  cohort: readonly SitemapTimelineCohortEntry[],
  captureDays: ReadonlyMap<string, string>,
): SitemapTimelineCohortEntry[] {
  return [...cohort].sort((a, b) => {
    const dayA = captureDays.get(a.domain) ?? "";
    const dayB = captureDays.get(b.domain) ?? "";
    if (dayA !== dayB) {
      return dayA < dayB ? -1 : 1;
    }
    return 0;
  });
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
            price_tier,
            captured_at,
            created_at
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
        extractPriceTier(snapshot.priceText),
        snapshot.capturedAt,
        nowIso(),
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
          throw new Error(`sitemap timeline backfill snapshot for ${entry.domain} was not persisted`);
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