/**
 * Full-Site Watch plan metering (design §5): per-tier capture budgets,
 * over-budget eviction, honest incompleteness reasons, the upgrade state
 * surfaced to the UI, and the workspace coverage aggregate for the weekly
 * brief.
 *
 * Honesty rules this module enforces (truthfulness wedge):
 *   - An over-budget scan is never "complete": it finalizes as `partial`
 *     with inventory_complete = 0, and the `over_budget` reason is derived
 *     from discovered_page_count > page_budget (no fabricated completeness).
 *   - watchedPageCount can never exceed knownPageCount — impossible inputs
 *     throw instead of producing a fake coverage claim.
 *   - The upgrade CTA is only offered when the tier budget actually bound.
 *
 * The schema's failure_code column is CHECK-constrained to status='failed',
 * so a policy-bounded (over-budget) scan carries its reason derivationally
 * instead of as a failure code. No migration is needed.
 */

import { queryOne } from "~/lib/data/d1.server";
import type { AppEnv } from "~/lib/env.server";
import {
  websiteCadenceForPlan,
  websitePageBudgetForPlan,
  type PlanFamily,
  type WebsiteScanCadenceCeiling,
} from "~/lib/plan-entitlements";
import type {
  WebsitePageDiscoverySource,
  WebsitePageKind,
  WebsiteSiteScanRecord,
} from "~/lib/types";

/** Where packet 4's coverage/upgrade card links. Existing upgrade route. */
export const WEBSITE_UPGRADE_HREF = "/app/billing?source=watchlists#plans";

const PLAN_LABEL: Record<PlanFamily, string> = {
  free: "Free",
  scout: "Scout",
  starter: "Starter",
  agency: "Agency",
};

/**
 * Watch priority by page class — the hottest classes win the budget.
 * pricing is hot (design: price changes are the point); home/changelog/
 * landing are warm; product/blog/docs cool; about/contact/other cold.
 * Eviction is the exact reverse of this order.
 */
export const PAGE_KIND_WATCH_PRIORITY: Record<WebsitePageKind, number> = {
  pricing: 0,
  home: 1,
  changelog: 2,
  landing: 3,
  product: 4,
  blog: 5,
  docs: 6,
  about: 7,
  contact: 8,
  other: 9,
};

export interface BudgetedWebsitePage {
  canonicalUrl: string;
  pageKind: WebsitePageKind;
  stableOrder: number;
  discoverySource?: WebsitePageDiscoverySource;
}

export interface WebsiteBudgetSelection<P extends BudgetedWebsitePage> {
  /** Pages that win the budget, hottest first (seed pages first). */
  kept: P[];
  /** Pages evicted by the budget, in eviction order (coldest first). */
  evicted: P[];
}

function pageKeepRank(page: BudgetedWebsitePage): number {
  // The watchlist's own seed page is the competitor the user explicitly
  // added; it outranks every discovered page of the same class heat.
  const seedBoost = page.discoverySource === "watchlist_seed" ? -1 : 0;
  return PAGE_KIND_WATCH_PRIORITY[page.pageKind] + seedBoost;
}

/**
 * Apply the tier budget to a discovered page inventory. Deterministic:
 * keep order is (seed first, class heat, stable_order, canonical_url);
 * the first `budget` pages are kept, the rest are evicted coldest-first.
 * Never claims the evicted set was watched.
 */
export function selectWebsitePagesForBudget<P extends BudgetedWebsitePage>(
  pages: P[],
  budget: number,
): WebsiteBudgetSelection<P> {
  if (!Number.isInteger(budget) || budget < 1) {
    throw new Error("website_budget_invalid: expected integer >= 1");
  }
  const ordered = [...pages].sort((a, b) => {
    const rankDelta = pageKeepRank(a) - pageKeepRank(b);
    if (rankDelta !== 0) {
      return rankDelta;
    }
    const orderDelta = a.stableOrder - b.stableOrder;
    if (orderDelta !== 0) {
      return orderDelta;
    }
    return a.canonicalUrl.localeCompare(b.canonicalUrl);
  });
  return {
    kept: ordered.slice(0, budget),
    evicted: ordered.slice(budget),
  };
}

/** Per-class cadences, hottest to coldest (matches design §2 vocabulary). */
export type WebsitePageCadence = "every_3h" | "every_6h" | "daily" | "weekly";

const CADENCE_RANK: Record<WebsitePageCadence, number> = {
  every_3h: 0,
  every_6h: 1,
  daily: 2,
  weekly: 3,
};

const CADENCE_BY_RANK: WebsitePageCadence[] = ["every_3h", "every_6h", "daily", "weekly"];

/**
 * Clamp a page class's cadence to what the plan allows: "per_class" leaves
 * the class cadence alone; "every_6h" caps hot classes at 6h; "weekly"
 * caps everything at the weekly slot. Pure — the scheduler combines this
 * with its PAGE_KIND_CADENCE map.
 */
export function applyWebsiteCadenceCeiling(
  planFamily: PlanFamily,
  pageKindCadence: WebsitePageCadence,
): WebsitePageCadence {
  const ceiling: WebsiteScanCadenceCeiling = websiteCadenceForPlan(planFamily);
  if (ceiling === "per_class") {
    return pageKindCadence;
  }
  const ceilingCadence: WebsitePageCadence = ceiling === "weekly" ? "weekly" : "every_6h";
  return CADENCE_BY_RANK[Math.max(CADENCE_RANK[pageKindCadence], CADENCE_RANK[ceilingCadence])];
}

/** Why a finalized scan's inventory is incomplete. */
export type WebsiteScanIncompleteReason = "over_budget" | "scan_failed" | "incomplete";

/**
 * The honest reason a finalized manifest did not watch the whole site.
 * `over_budget` is derived from the manifest's own counts (discovered
 * exceeds the tier budget stored on the scan); `scan_failed` when the
 * manifest carries a failure code; `incomplete` for any other partial
 * inventory (e.g. sitemap could not be fully fetched). Returns null for a
 * complete inventory — never invents a reason where there is none.
 */
export function websiteScanIncompleteReason(scan: {
  inventoryComplete: boolean;
  discoveredPageCount: number;
  pageBudget: number;
  failureCode: string | null;
}): WebsiteScanIncompleteReason | null {
  if (scan.inventoryComplete) {
    return null;
  }
  if (scan.discoveredPageCount > scan.pageBudget) {
    return "over_budget";
  }
  if (scan.failureCode) {
    return "scan_failed";
  }
  return "incomplete";
}

export interface WebsiteUpgradeStateInput {
  planFamily: PlanFamily;
  /** Pages known to exist (discovered inventory size). */
  knownPageCount: number;
  /** Pages actually watched (fetched observations). */
  watchedPageCount: number;
  inventoryComplete: boolean;
  /** Manifest failure code, when the scan failed. */
  failureCode?: string | null;
}

export interface WebsiteUpgradeState {
  planFamily: PlanFamily;
  planLabel: string;
  pageBudget: number;
  knownPageCount: number;
  watchedPageCount: number;
  inventoryComplete: boolean;
  overBudget: boolean;
  reasonCode: WebsiteScanIncompleteReason | null;
  failureCode: string | null;
  /** Honest one-liner for the coverage/upgrade card. */
  message: string;
  /** Set only when the tier budget actually bound. */
  upgradeHref: string | null;
  upgradeCtaLabel: string | null;
}

/**
 * The honest upgrade state for one competitor on one plan: what is known,
 * what is watched, whether the tier budget bound, and the upgrade CTA —
 * only when it did. No silent truncation: an over-budget watch always
 * says so.
 */
export function buildWebsiteUpgradeState(input: WebsiteUpgradeStateInput): WebsiteUpgradeState {
  const { planFamily, knownPageCount, watchedPageCount, inventoryComplete } = input;
  if (!Number.isInteger(knownPageCount) || knownPageCount < 0) {
    throw new Error("website_upgrade_state_invalid: knownPageCount must be an integer >= 0");
  }
  if (!Number.isInteger(watchedPageCount) || watchedPageCount < 0) {
    throw new Error("website_upgrade_state_invalid: watchedPageCount must be an integer >= 0");
  }
  if (watchedPageCount > knownPageCount) {
    throw new Error(
      "website_upgrade_state_inconsistent: watchedPageCount cannot exceed knownPageCount",
    );
  }
  const failureCode = input.failureCode ?? null;
  const pageBudget = websitePageBudgetForPlan(planFamily);
  const overBudget = knownPageCount > pageBudget;
  const reasonCode = websiteScanIncompleteReason({
    inventoryComplete,
    discoveredPageCount: knownPageCount,
    pageBudget,
    failureCode,
  });
  const planLabel = PLAN_LABEL[planFamily];
  const message = overBudget
    ? `This competitor has ${knownPageCount} known pages; your ${planLabel} plan watches up to ${pageBudget}. Upgrade to watch them all.`
    : inventoryComplete
      ? `Watching all ${knownPageCount} known pages.`
      : `Watching ${watchedPageCount} of ${knownPageCount} known pages.`;

  return {
    planFamily,
    planLabel,
    pageBudget,
    knownPageCount,
    watchedPageCount,
    inventoryComplete,
    overBudget,
    reasonCode,
    failureCode,
    message,
    upgradeHref: overBudget ? WEBSITE_UPGRADE_HREF : null,
    upgradeCtaLabel: overBudget ? "See upgrade options" : null,
  };
}

/** Convenience adapter from a scan manifest to the upgrade state. */
export function websiteUpgradeStateForScan(
  planFamily: PlanFamily,
  scan: Pick<
    WebsiteSiteScanRecord,
    "discoveredPageCount" | "fetchedPageCount" | "inventoryComplete" | "failureCode"
  >,
): WebsiteUpgradeState {
  return buildWebsiteUpgradeState({
    planFamily,
    knownPageCount: scan.discoveredPageCount,
    watchedPageCount: scan.fetchedPageCount,
    inventoryComplete: scan.inventoryComplete,
    failureCode: scan.failureCode,
  });
}

export interface WebsiteCoverageSummary {
  /** Competitors (watchlists) with at least one finalized site scan. */
  competitorCount: number;
  /** Σ known pages across each competitor's latest finalized scan. */
  knownPageCount: number;
  /** Σ watched pages across each competitor's latest finalized scan. */
  watchedPageCount: number;
  /** How many of those scans hold a complete inventory. */
  inventoryCompleteCount: number;
  /** How many of those scans were bounded by the tier budget. */
  overBudgetCount: number;
}

interface WebsiteCoverageSummaryRow {
  competitor_count: number;
  known_page_count: number | null;
  watched_page_count: number | null;
  inventory_complete_count: number | null;
  over_budget_count: number | null;
}

/**
 * Honest totals for the weekly brief's "watched N of M known pages across
 * K competitors" line. Only each watchlist's latest finalized scan counts
 * (running manifests carry un-recomputed counts); partial scans count with
 * their real subset numbers — truncation is never hidden.
 */
export async function summarizeWebsiteCoverageForWorkspace(
  env: AppEnv,
  workspaceId: string,
): Promise<WebsiteCoverageSummary> {
  const row = await queryOne<WebsiteCoverageSummaryRow>(
    env,
    `
      SELECT
        COUNT(*) AS competitor_count,
        SUM(ws.discovered_page_count) AS known_page_count,
        SUM(ws.fetched_page_count) AS watched_page_count,
        SUM(ws.inventory_complete) AS inventory_complete_count,
        SUM(CASE WHEN ws.discovered_page_count > ws.page_budget THEN 1 ELSE 0 END) AS over_budget_count
      FROM website_site_scan ws
      INNER JOIN watchlist_run wr ON wr.id = ws.watchlist_run_id
      WHERE ws.workspace_id = ?
        AND ws.status IN ('complete', 'partial', 'failed')
        AND NOT EXISTS (
          SELECT 1
          FROM website_site_scan ws2
          INNER JOIN watchlist_run wr2 ON wr2.id = ws2.watchlist_run_id
          WHERE ws2.workspace_id = ws.workspace_id
            AND ws2.watchlist_id = ws.watchlist_id
            AND ws2.status IN ('complete', 'partial', 'failed')
            AND (
              wr2.started_at > wr.started_at
              OR (wr2.started_at = wr.started_at AND wr2.id > wr.id)
            )
        )
    `,
    workspaceId,
  );
  return {
    competitorCount: row?.competitor_count ?? 0,
    knownPageCount: row?.known_page_count ?? 0,
    watchedPageCount: row?.watched_page_count ?? 0,
    inventoryCompleteCount: row?.inventory_complete_count ?? 0,
    overBudgetCount: row?.over_budget_count ?? 0,
  };
}

/** "Watched 120 of 180 known pages across 3 competitors." */
export function formatWebsiteCoverageLine(summary: WebsiteCoverageSummary): string {
  const competitor = summary.competitorCount === 1 ? "competitor" : "competitors";
  return `Watched ${summary.watchedPageCount} of ${summary.knownPageCount} known pages across ${summary.competitorCount} ${competitor}.`;
}

/**
 * Transitional flag read until packet 2 lands FULLSITE_WATCH_ENABLED on
 * AppEnv (it owns that file). Reads defensively so this module compiles
 * and stays flag-off (undefined → false) before that lands; semantics
 * match env.server.ts parseEnvFlag exactly.
 */
export function isFullsiteWatchEnabled(env: AppEnv): boolean {
  const raw = (env as AppEnvWithWebsiteFlag).FULLSITE_WATCH_ENABLED;
  if (!raw) {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

type AppEnvWithWebsiteFlag = AppEnv & {
  FULLSITE_WATCH_ENABLED?: string;
};

/**
 * The brief builder's one-line dependency: the coverage line when Full-Site
 * Watch is enabled, null otherwise (flag-off renders nothing at all).
 */
export async function websiteCoverageDigestLine(
  env: AppEnv,
  workspaceId: string,
): Promise<string | null> {
  if (!isFullsiteWatchEnabled(env)) {
    return null;
  }
  return formatWebsiteCoverageLine(await summarizeWebsiteCoverageForWorkspace(env, workspaceId));
}
