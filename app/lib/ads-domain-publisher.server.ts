/**
 * Programmatic /ads/:domain publisher (BET 5a, issue #1549).
 *
 * The seed-list pipeline: for every domain in a curated `data/seed-lists/*.json`
 * cluster list, run the search-v2 "exact" pipeline for country "all" and decide
 * publish vs skip from the three-tier verdict —
 *
 *   publish: verifiedCount + likelyCount >= 1   (the page will render a real
 *            ad wall, not an empty shell)
 *   skip:    unmatched-only or empty            (never ships an empty page —
 *            BET 5's "gated so no page ships empty" rule)
 *
 * A publish IS the cache write made by `searchAdsViaSourceResolver` with
 * purpose `public_search` under the exact search-v2 domain key the
 * /ads/:domain loader derives (scope "exact", country "all"). No further
 * persistence happens in this module:
 *   - the /ads/:domain page renders from that row (loadBrandPageCacheSnapshot),
 *   - the dynamic sitemap lists it (loadIndexableBrandPageEntries), and
 *   - the sitemap.xml response is server-rendered with `max-age=3600`, so a
 *     newly published page appears to crawlers within an hour — node CDN
 *     purges are neither available on free cache API nor needed.
 *
 * BET 2 gate: the publisher only runs when the search-v2 three-tier pipeline
 * is the active rollout (`SEARCH_ROLLOUT_MODE=v2` → `shouldApplySearchV2`).
 * If the rollout is shadow/legacy the run aborts before any provider call and
 * logs `ads_domain_publisher_run` with `gate: "bet2_inactive"`, so the fleet
 * can never publish untiered pages. The CI/live three-tier gate is the
 * existing `npm run canary:bet2` (scripts/bet2-live-verification.mjs).
 *
 * Metrics (console JSON, matching the search-observability pattern):
 *   ads_domain_published / ads_domain_skipped / ads_domain_failed per domain,
 *   and one ads_domain_publisher_run summary per run.
 *
 * Cost guard: this runs live provider captures for domains whose public_search
 * cache has expired (TTL 15 min), so the per-run domain ceiling is a hard cap.
 * The cron rides the existing 04:00 daily rail (same pattern as the demo-brand
 * backfill) so it keeps the release-soak observation contract untouched.
 */

import sneakerResaleSeedList from "../../data/seed-lists/sneaker-resale.json";
import { hydrateAdsWithPersistedCreatives } from "~/lib/ad-persistence.server";
import {
  resolveCommercialDiscoveryProvider,
  searchAdsViaSourceResolver,
} from "~/lib/ad-source.server";
import type { AppEnv } from "~/lib/env.server";
import { normalizeSearchFilters } from "~/lib/normalize";
import { shouldApplySearchV2 } from "~/lib/search-rollout.server";
import {
  applySearchV2PostFilter,
  buildSearchV2CacheKey,
  buildSearchV2Context,
  buildSearchV2SavedQuery,
} from "~/lib/search-v2.server";
import type { AdDiscoveryProvider } from "~/lib/types";

/** One entry in a curated seed list. `brand` is display metadata only. */
export interface SeedListEntry {
  domain: string;
  brand?: string;
}

/** The versioned seed-list file shape (data/seed-lists/*.json). */
export interface SeedList {
  cluster: string;
  asOf: string;
  sourceNote?: string;
  domains: SeedListEntry[];
}

/** The registry: every bundled data/seed-lists/<cluster>.json list. */
export const SEED_LISTS: Readonly<Record<string, SeedList>> = Object.freeze({
  "sneaker-resale": sneakerResaleSeedList as SeedList,
});

/** Default per-run domain ceiling; override with ADS_DOMAIN_PUBLISHER_CAP. */
export const ADS_DOMAIN_PUBLISHER_CAP_DEFAULT = 60;

/**
 * The publish floor: at least one verified OR likely ad. A domain whose only
 * coverage is unmatched candidates renders a wall of unverified matches — the
 * page must never ship as a published SEO surface on unproven coverage
 * (research §3.4 BET 5a: "gated so no page ships empty"). The /ads/:domain
 * loader additionally self-noindexes pages that cannot render the Aggression
 * Score, so a publish here is the publisher's gate only; indexability stays
 * with the page's existing honesty rules.
 */
export function classifySeedListVerdict(
  verifiedCount: number,
  likelyCount: number,
): "publish" | "skip" {
  return verifiedCount + likelyCount >= 1 ? "publish" : "skip";
}

/**
 * Pure seed-list validation. Returns the list of problems (empty = valid):
 * - cluster name missing or empty,
 * - asOf missing,
 * - zero or more than PUBLISHER_SEED_LIST_MAX_DOMAINS domains,
 * - a domain that `URL` cannot normalize (non-http(s) or hostless),
 * - duplicate registrable domains (case-insensitive).
 * Used by the publisher (a malformed list fails the run without touching the
 * provider) and by tests.
 */
export const PUBLISHER_SEED_LIST_MAX_DOMAINS = 200;

export function validateSeedList(list: SeedList): readonly string[] {
  const problems: string[] = [];
  if (!list.cluster?.trim()) {
    problems.push("cluster must be a non-empty string");
  }
  if (!list.asOf?.trim()) {
    problems.push("asOf must be a non-empty string");
  }
  if (!Array.isArray(list.domains) || list.domains.length === 0) {
    problems.push("domains must be a non-empty array");
    return problems;
  }
  if (list.domains.length > PUBLISHER_SEED_LIST_MAX_DOMAINS) {
    problems.push(
      `domains exceeds the ${PUBLISHER_SEED_LIST_MAX_DOMAINS} entry ceiling`,
    );
  }
  const seen = new Set<string>();
  for (const entry of list.domains) {
    if (!entry.domain?.trim()) {
      problems.push(`entry with missing domain at index ${list.domains.indexOf(entry)}`);
      continue;
    }
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(entry.domain)
      ? entry.domain
      : `https://${entry.domain}`;
    let host: string | null = null;
    try {
      const url = new URL(candidate);
      host = url.protocol === "http:" || url.protocol === "https:" ? url.hostname.toLowerCase().replace(/^www\./, "") : null;
    } catch {
      host = null;
    }
    if (!host) {
      problems.push(`domain "${entry.domain}" is not a valid http(s) hostname`);
      continue;
    }
    const key = host.replace(/\.$/, "");
    if (seen.has(key)) {
      problems.push(`duplicate domain "${entry.domain}"`);
    }
    seen.add(key);
  }
  return problems;
}

/** The list-name → resolved registry list, or null when unknown. */
export function resolveSeedList(name: string): SeedList | null {
  return SEED_LISTS[name?.trim()] ?? null;
}

export interface AdsDomainPublisherDomainOutcome {
  domain: string;
  verdict: "publish" | "skip" | "failed" | "invalid";
  reason: string;
  verifiedCount?: number;
  likelyCount?: number;
  unmatchedCount?: number;
  cacheStatus?: string | null;
}

export interface AdsDomainPublisherRunSummary {
  list: string;
  gate: "bet2_active" | "bet2_inactive" | "no_provider";
  attempted: number;
  published: number;
  skipped: number;
  failed: number;
  invalid: number;
  outcomes: AdsDomainPublisherDomainOutcome[];
}

function emitPublisherEvent(
  event: Record<string, unknown>,
) {
  console.info(
    JSON.stringify({
      ...event,
      ts: new Date().toISOString(),
    }),
  );
}

/**
 * Run the publisher for one seed list. BET 2 gate first; then per domain:
 * search-v2 exact pipeline for country "all" via the real resolver (which
 * persists the public_search discovery-cache row on success — that row IS the
 * published /ads/:domain page and its sitemap entry), classify the tier
 * verdict, and emit the ads_domain_* observability events. A single-domain
 * failure is logged and counted, never thrown: one flaky provider call must
 * not stop the whole nightly run (the run summary surfaces it).
 */
export async function runAdsDomainPublisher(
  env: AppEnv,
  ctx?: Pick<ExecutionContext, "waitUntil"> | null,
  options: { list?: string; cap?: number } = {},
): Promise<AdsDomainPublisherRunSummary> {
  const activeLists = options.list?.trim()
    ? [options.list.trim()]
    : Object.keys(SEED_LISTS);
  const firstList = activeLists[0] ?? null;

  if (!firstList || !resolveSeedList(firstList)) {
    return {
      list: options.list?.trim() ?? "(none)",
      gate: "bet2_active",
      attempted: 0,
      published: 0,
      skipped: 0,
      failed: 0,
      invalid: 0,
      outcomes: [],
    };
  }

  // BET 2 gate: three-tier search-v2 must be the active rollout, or the run
  // aborts before a single provider call. Never publish untiered pages.
  if (!shouldApplySearchV2(env)) {
    emitPublisherEvent({
      metric: "ads_domain_publisher_run",
      list: firstList,
      gate: "bet2_inactive",
      note: "SEARCH_ROLLOUT_MODE is not v2; three-tier search is not active. Skipped.",
    });
    return {
      list: firstList,
      gate: "bet2_inactive",
      attempted: 0,
      published: 0,
      skipped: 0,
      failed: 0,
      invalid: 0,
      outcomes: [],
    };
  }

  const provider = resolveCommercialDiscoveryProvider(env);
  if (provider === "demo" || !env.DB) {
    emitPublisherEvent({
      metric: "ads_domain_publisher_run",
      list: firstList,
      gate: "no_provider",
      provider,
      note: "No commercial discovery provider / D1; a publish would have nothing real to render.",
    });
    return {
      list: firstList,
      gate: "no_provider",
      attempted: 0,
      published: 0,
      skipped: 0,
      failed: 0,
      invalid: 0,
      outcomes: [],
    };
  }

  const cap = Number.isFinite(options.cap)
    ? Math.max(1, Math.floor(options.cap ?? 0))
    : Math.max(1, Math.floor(Number(env.ADS_DOMAIN_PUBLISHER_CAP) || ADS_DOMAIN_PUBLISHER_CAP_DEFAULT));

  const summary: AdsDomainPublisherRunSummary = {
    list: firstList,
    gate: "bet2_active",
    attempted: 0,
    published: 0,
    skipped: 0,
    failed: 0,
    invalid: 0,
    outcomes: [],
  };

  for (const entry of firstListDomains(firstList)) {
    if (summary.attempted >= cap) {
      break;
    }
    summary.attempted += 1;

    try {
      const outcome = await publishSeedListDomain(env, entry.domain, ctx, provider, firstList);
      summary.outcomes.push(outcome);
      if (outcome.verdict === "publish") {
        summary.published += 1;
      } else if (outcome.verdict === "skip") {
        summary.skipped += 1;
      } else if (outcome.verdict === "invalid") {
        summary.invalid += 1;
      } else {
        summary.failed += 1;
      }
    } catch (error) {
      summary.failed += 1;
      summary.outcomes.push({
        domain: entry.domain,
        verdict: "failed",
        reason: error instanceof Error ? error.message : "Unknown publisher error.",
      });
      emitPublisherEvent({
        metric: "ads_domain_failed",
        list: firstList,
        domain: entry.domain,
        errorName: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  emitPublisherEvent({
    metric: "ads_domain_publisher_run",
    list: firstList,
    gate: "bet2_active",
    attempted: summary.attempted,
    published: summary.published,
    skipped: summary.skipped,
    failed: summary.failed,
    invalid: summary.invalid,
  });

  return summary;
}

function firstListDomains(
  listName: string,
): SeedListEntry[] {
  const list = resolveSeedList(listName);
  if (!list) {
    return [];
  }
  const problems = validateSeedList(list);
  if (problems.length > 0) {
    emitPublisherEvent({
      metric: "ads_domain_publisher_run",
      list: listName,
      gate: "bet2_active",
      note: "Seed list failed validation; no domains attempted.",
      problems,
    });
    return [];
  }
  return list.domains;
}

/**
 * Publish (or skip) one domain: the exact search-v2 pipeline the /search
 * route runs when SEARCH_ROLLOUT_MODE=v2 — context → v2 saved query →
 * resolver (writes the public_search cache row) → hydrate → post-filter →
 * tier verdict. Country "all" is one of the always-tried scopes the
 * /ads/:domain loader and the sitemap read, so a published row renders for
 * every crawler regardless of geo.
 */
async function publishSeedListDomain(
  env: AppEnv,
  domain: string,
  ctx: Pick<ExecutionContext, "waitUntil"> | null | undefined,
  provider: AdDiscoveryProvider,
  listName: string,
): Promise<AdsDomainPublisherDomainOutcome> {
  const v2Context = await buildSearchV2Context(domain, "exact");
  if (!v2Context) {
    return {
      domain,
      verdict: "invalid",
      reason: "Not a domain-shaped website input; nothing to publish.",
    };
  }

  const filters = normalizeSearchFilters({ country: "all" });
  const query = buildSearchV2SavedQuery(v2Context.queryIntent, "exact", filters, {
    identityAliases: v2Context.identityAliases,
  });
  const cacheKeyOverride = buildSearchV2CacheKey({
    provider,
    intent: v2Context.queryIntent,
    scope: "exact",
    country: "all",
  });
  const rawResult = await searchAdsViaSourceResolver(env, query, null, {
    purpose: "public_search",
    cacheKeyOverride,
    executionContext: ctx ?? null,
  });
  const hydratedAds = await hydrateAdsWithPersistedCreatives(env, rawResult.ads);
  const v2Result = await applySearchV2PostFilter(env, { ...rawResult, ads: hydratedAds }, v2Context);

  const verdict = classifySeedListVerdict(v2Result.verifiedCount, v2Result.likelyCount);
  const reason =
    verdict === "publish"
      ? `≥1 verified/likely result (${v2Result.verifiedCount}+${v2Result.likelyCount})`
      : `No verified/likely coverage (${v2Result.verifiedCount} verified, ${v2Result.likelyCount} likely, ${v2Result.unmatchedCount} unmatched)${
          v2Result.discoveryEmptyReason ? `; empty reason: ${v2Result.discoveryEmptyReason}` : ""
        }`;

  emitPublisherEvent({
    metric: verdict === "publish" ? "ads_domain_published" : "ads_domain_skipped",
    list: listName,
    domain,
    verifiedCount: v2Result.verifiedCount,
    likelyCount: v2Result.likelyCount,
    unmatchedCount: v2Result.unmatchedCount,
    provider: v2Result.provider ?? v2Result.source ?? null,
    cacheStatus: v2Result.cacheStatus ?? null,
    discoveryStatus: v2Result.discoveryStatus ?? null,
  });

  return {
    domain,
    verdict,
    reason,
    verifiedCount: v2Result.verifiedCount,
    likelyCount: v2Result.likelyCount,
    unmatchedCount: v2Result.unmatchedCount,
    cacheStatus: v2Result.cacheStatus ?? null,
  };
}