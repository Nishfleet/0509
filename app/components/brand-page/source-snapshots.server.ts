/**
 * Public brand-page source-snapshot loader (issue #2200).
 *
 * The /ads/:domain and /timeline/:domain public pages render the new
 * competitor-monitoring sources (Google Ads, Google Search, LinkedIn,
 * TikTok, subdomains, hiring) from the SAME generic snapshot store the
 * logged-in competitor page uses (`getLatestSourceSnapshot` in
 * ~/lib/sources/run.server.ts). The public page NEVER triggers a fetch —
 * it only reads stored snapshots.
 *
 * A source section renders only when BOTH hold:
 *   (a) its claim-table row is live — the adapter is `implemented` AND
 *       `requiresEnv(env)` is true (the same rule
 *       presence-source-coverage.server.ts uses to resolve "configured");
 *   (b) a snapshot exists for the brand (at least one watchlist tracking
 *       the domain has a stored `source_snapshot` row for that source).
 *
 * Missing = section omitted entirely, no placeholder.
 *
 * Domain → watchlist resolution mirrors `loadAdsDomainRecentChanges`
 * (~/lib/ads-domain-recent-changes.server.ts): an advertiser watchlist's
 * `target_id` is its normalized website URL, and the registrable domain
 * decides the match. Query-only advertiser watchlists track no domain and
 * never match.
 *
 * This module is read-only. It never edits the registry, the snapshot
 * store, the claim table, or any source adapter — it imports them and
 * calls their read paths only.
 */
import { registrableDomainFromLandingPage } from "~/lib/competitor-website";
import { queryAll } from "~/lib/data/d1.server";
import type { AppEnv } from "~/lib/env.server";
import { getLatestSourceSnapshot } from "~/lib/sources/run.server";
import { SOURCES } from "~/lib/sources/registry.server";
import type { SourceId, SourceSnapshotRecord } from "~/lib/sources/types";

/**
 * One source's latest snapshot for a brand, plus the adapter label for
 * rendering. `null` snapshot means no snapshot exists — the section omits.
 */
export interface BrandPageSourceSnapshot {
  sourceId: SourceId;
  label: string;
  snapshot: SourceSnapshotRecord;
}

/**
 * Load the latest snapshot per LIVE source for a brand domain. Returns only
 * sources that are (a) implemented + env-enabled AND (b) have at least one
 * stored snapshot for a watchlist tracking the domain. Empty array when no
 * watchlist tracks the domain or no live source has a snapshot — the page
 * omits every section in that case.
 *
 * Bounded D1 reads: one watchlist lookup + at most one snapshot read per
 * live source. A read hiccup degrades to an empty result (sections hide)
 * rather than 500ing the page — the caller wraps this in try/catch.
 */
export async function loadBrandPageSourceSnapshots(
  env: AppEnv,
  domain: string,
): Promise<BrandPageSourceSnapshot[]> {
  // The live sources for this env — implemented AND requiresEnv true. This
  // is the "claim-table row is live" gate (issue #2200 step 1a).
  const liveSources = SOURCES.filter(
    (adapter) => adapter.implemented && adapter.requiresEnv(env),
  );
  if (liveSources.length === 0) {
    return [];
  }

  // Find every advertiser watchlist tracking this domain — same identity
  // rule as loadAdsDomainRecentChanges.
  const candidates = await queryAll<{ id: string; target_id: string }>(
    env,
    `
      SELECT id, target_id
      FROM watchlist
      WHERE target_type = 'advertiser'
        AND is_active = 1
    `,
  );
  const watchlistIds = candidates
    .filter((row) => registrableDomainFromLandingPage(row.target_id) === domain)
    .map((row) => row.id);
  if (watchlistIds.length === 0) {
    return [];
  }

  // For each live source, find the newest snapshot across the matching
  // watchlists. A source with no snapshot for any tracking watchlist omits.
  const results: BrandPageSourceSnapshot[] = [];
  for (const adapter of liveSources) {
    let newest: SourceSnapshotRecord | null = null;
    for (const watchlistId of watchlistIds) {
      const snapshot = await getLatestSourceSnapshot(env, watchlistId, adapter.id);
      if (!snapshot) continue;
      if (!newest || snapshot.fetchedAt > newest.fetchedAt) {
        newest = snapshot;
      }
    }
    if (newest) {
      results.push({ sourceId: adapter.id, label: adapter.label, snapshot: newest });
    }
  }
  return results;
}
