import {
  hasFreshDiscoveryCacheEntry,
  resolveCommercialDiscoveryProvider,
  searchAdsViaSourceResolver,
} from "~/lib/ad-source.server";
import { queryAll } from "~/lib/data/d1.server";
import type { AppEnv } from "~/lib/env.server";
import { normalizeSearchFilters } from "~/lib/normalize";
import { parseSearchInputFromWebsiteField } from "~/lib/search-query";
import {
  buildSearchV2CacheKey,
  buildSearchV2SavedQuery,
} from "~/lib/search-v2.server";
import { CommercialDiscoveryError } from "~/lib/meta-library-browser.server";
import type { SearchFilters } from "~/lib/types";

/**
 * Fixed 12-brand eval panel. Domains match discovery-spike-v2/domains.txt;
 * vertical probes match discover_v2.py VERTICAL_KEYWORDS so the coverage
 * script stays comparable to the spike termination check.
 */
export const DISCOVERY_EVAL_PANEL = [
  {
    domain: "allbirds.com",
    brandQuery: "allbirds",
    verticals: ["running shoes", "athletic wear", "wool shoes"],
  },
  {
    domain: "notion.so",
    brandQuery: "notion",
    verticals: ["team wiki", "note taking app", "knowledge base"],
  },
  {
    domain: "ouraring.com",
    brandQuery: "oura",
    verticals: ["smart ring", "fitness tracker", "sleep tracker"],
  },
  {
    domain: "nykaa.com",
    brandQuery: "nykaa",
    verticals: ["beauty products", "skincare", "indian cosmetics"],
  },
  {
    domain: "gymshark.com",
    brandQuery: "gymshark",
    verticals: ["gym clothing", "athletic wear", "fitness apparel"],
  },
  {
    domain: "hubspot.com",
    brandQuery: "hubspot",
    verticals: ["crm platform", "inbound marketing", "sales pipeline"],
  },
  {
    domain: "ridgewallet.com",
    brandQuery: "ridge",
    verticals: ["minimalist wallet", "leather wallet", "mens wallet"],
  },
  {
    domain: "bombayshavingcompany.com",
    brandQuery: "bombay shaving",
    verticals: ["shaving", "beard care", "mens grooming"],
  },
  {
    domain: "curofy.com",
    brandQuery: "curofy",
    verticals: ["telemedicine", "online doctor", "doctor app"],
  },
  {
    domain: "mailchimp.com",
    brandQuery: "mailchimp",
    verticals: ["email marketing", "crm platform", "drip campaign"],
  },
  {
    domain: "canva.com",
    brandQuery: "canva",
    verticals: ["logo maker", "graphic design", "design tool"],
  },
  {
    domain: "plausible.io",
    brandQuery: "plausible",
    verticals: ["web analytics", "site analytics", "analytics tool"],
  },
] as const;

export const DISCOVERY_EVAL_PANEL_DOMAINS = DISCOVERY_EVAL_PANEL.map(
  (row) => row.domain,
);

const PANEL_SEARCH_FILTERS: SearchFilters = normalizeSearchFilters({
  query: "",
  country: "all",
});

export interface DiscoveryPanelCoverageRow {
  domain: string;
  adCount: number;
}

export interface DiscoveryPanelCoverage {
  covered: number;
  total: number;
  perDomain: Array<{ domain: string; adCount: number; covered: boolean }>;
}

/** ≥1 ad on the public `/search?website=` path counts as covered. */
export function scoreDiscoveryPanelCoverage(
  rows: DiscoveryPanelCoverageRow[],
): DiscoveryPanelCoverage {
  const byDomain = new Map(rows.map((row) => [row.domain, row.adCount]));
  const perDomain = DISCOVERY_EVAL_PANEL_DOMAINS.map((domain) => {
    const adCount = byDomain.get(domain) ?? 0;
    return { domain, adCount, covered: adCount >= 1 };
  });
  return {
    covered: perDomain.filter((row) => row.covered).length,
    total: perDomain.length,
    perDomain,
  };
}

export function formatDiscoveryPanelCoverageReport(
  coverage: DiscoveryPanelCoverage,
  options: { generatedAt?: string; note?: string } = {},
) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const lines = [
    "# Discovery panel coverage",
    "",
    `Generated: ${generatedAt}`,
    `Covered: ${coverage.covered}/${coverage.total}`,
    "",
    "| Domain | Ads | Covered |",
    "|---|---:|:---:|",
    ...coverage.perDomain.map(
      (row) => `| ${row.domain} | ${row.adCount} | ${row.covered ? "yes" : "no"} |`,
    ),
  ];
  if (options.note) {
    lines.push("", options.note);
  }
  return `${lines.join("\n")}\n`;
}

export interface DiscoveryPanelWarmupResult {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

/**
 * Top-N recency cap for the issue-2403 warm pass: the number of distinct
 * registrable domains pulled from recent public_search cache rows.
 */
export const PUBLIC_SEARCH_WARMUP_DOMAIN_LIMIT = 200;

/**
 * Live provider fetches the recent-domain warm pass may make in one cron
 * run. Most of the top-200 list is already warm on steady state, so the
 * per-run budget stays small; cold domains converge to warm over successive
 * 6-hourly runs instead of one oversized cron invocation.
 */
export const PUBLIC_SEARCH_WARMUP_ATTEMPT_LIMIT = 25;

const SEARCH_V2_DOMAIN_KEY_PREFIX = "search-v2:domain:";

/**
 * Extracts distinct registrable domains from search-v2 domain cache keys,
 * in the order given (callers pass keys ordered by recency). Malformed or
 * non-domain keys are dropped silently — they are foreign key shapes.
 */
export function registrableDomainsFromSearchV2CacheKeys(
  cacheKeys: readonly string[],
  limit: number = PUBLIC_SEARCH_WARMUP_DOMAIN_LIMIT,
): string[] {
  const seen = new Set<string>();
  const domains: string[] = [];
  for (const cacheKey of cacheKeys) {
    if (!cacheKey.startsWith(SEARCH_V2_DOMAIN_KEY_PREFIX)) {
      continue;
    }
    const domain = cacheKey
      .slice(SEARCH_V2_DOMAIN_KEY_PREFIX.length)
      .split(":")[0]
      ?.trim()
      .toLowerCase();
    if (!domain || seen.has(domain)) {
      continue;
    }
    seen.add(domain);
    domains.push(domain);
    if (domains.length >= limit) {
      break;
    }
  }
  return domains;
}

/**
 * Issue 2403: pre-warms the domains people actually search so the
 * no-account preview serves from cache instead of hitting the 60s warming
 * wall. The source is `discovery_cache_entry` rows with
 * `route_context='public_search'` and a `search-v2:domain:` key — i.e. the
 * domains visitors already searched — ranked by `updated_at` recency, NOT
 * funnel events (those carry no domain by construction). Reuses the same
 * public_search_warmup family and freshness skip as the eval panel.
 */
export async function warmRecentPublicSearchDomains(
  env: AppEnv,
  ctx?: Pick<ExecutionContext, "waitUntil"> | null,
): Promise<DiscoveryPanelWarmupResult> {
  const empty = { attempted: 0, succeeded: 0, failed: 0, skipped: 0 };
  if (!env.DB) {
    return empty;
  }

  let cacheKeys: string[];
  try {
    const rows = await queryAll<{ cache_key: string }>(
      env,
      `
        SELECT cache_key
        FROM discovery_cache_entry
        WHERE route_context = 'public_search'
          AND cache_key LIKE ?
        ORDER BY updated_at DESC
        LIMIT ?
      `,
      `${SEARCH_V2_DOMAIN_KEY_PREFIX}%`,
      PUBLIC_SEARCH_WARMUP_DOMAIN_LIMIT,
    );
    cacheKeys = rows.map((row) => row.cache_key);
  } catch {
    // No cache table (fresh D1) or transient read failure: the cron pass
    // must not fail the whole warmup over an optional top-up.
    return empty;
  }

  const domains = registrableDomainsFromSearchV2CacheKeys(cacheKeys);
  if (domains.length === 0) {
    return { ...empty };
  }

  const provider = resolveCommercialDiscoveryProvider(env);
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const domain of domains) {
    const intent = parseSearchInputFromWebsiteField(domain);
    if (intent.intent !== "domain" || !intent.registrableDomain) {
      skipped += 1;
      continue;
    }

    const query = buildSearchV2SavedQuery(intent, "exact", PANEL_SEARCH_FILTERS, {
      identityAliases: [],
    });
    const cacheKeyOverride = buildSearchV2CacheKey({
      provider,
      intent,
      scope: "exact",
      country: query.filters.country || "all",
      filters: query.filters,
    });

    let alreadyWarm = false;
    try {
      alreadyWarm = await hasFreshDiscoveryCacheEntry(env, query, null, {
        cacheKeyOverride,
        purpose: "public_search_warmup",
      });
    } catch {
      alreadyWarm = false;
    }
    if (alreadyWarm) {
      skipped += 1;
      continue;
    }

    // Per-run live-fetch budget: everything beyond the cap waits for the
    // next 6-hourly pass rather than stretching this cron run.
    if (attempted >= PUBLIC_SEARCH_WARMUP_ATTEMPT_LIMIT) {
      skipped += 1;
      continue;
    }

    attempted += 1;
    try {
      const response = await searchAdsViaSourceResolver(env, query, null, {
        purpose: "public_search_warmup",
        cacheKeyOverride,
        executionContext: ctx ?? null,
      });
      if (
        response.discoveryStatus === "cache_only" ||
        response.cacheStatus === "stale"
      ) {
        skipped += 1;
        continue;
      }
      succeeded += 1;
    } catch (error) {
      failed += 1;
      if (error instanceof CommercialDiscoveryError) {
        continue;
      }
      throw error;
    }
  }

  return { attempted, succeeded, failed, skipped };
}

/**
 * Pre-fills the public-search cache (search-v2 domain keys, country=all,
 * exact scope) for the eval panel. Purpose is public_search_warmup so the
 * write uses a 24h TTL while remaining readable by `/search?website=`.
 */
export async function warmDiscoveryEvalPanel(
  env: AppEnv,
  ctx?: Pick<ExecutionContext, "waitUntil"> | null,
): Promise<DiscoveryPanelWarmupResult> {
  if (!env.DB) {
    return { attempted: 0, succeeded: 0, failed: 0, skipped: 0 };
  }

  const provider = resolveCommercialDiscoveryProvider(env);
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const brand of DISCOVERY_EVAL_PANEL) {
    const intent = parseSearchInputFromWebsiteField(brand.domain);
    if (intent.intent !== "domain" || !intent.registrableDomain) {
      skipped += 1;
      continue;
    }

    const query = buildSearchV2SavedQuery(intent, "exact", PANEL_SEARCH_FILTERS, {
      identityAliases: brand.brandQuery ? [brand.brandQuery] : [],
    });
    const cacheKeyOverride = buildSearchV2CacheKey({
      provider,
      intent,
      scope: "exact",
      country: query.filters.country || "all",
      filters: query.filters,
    });

    let alreadyWarm = false;
    try {
      alreadyWarm = await hasFreshDiscoveryCacheEntry(env, query, null, {
        cacheKeyOverride,
        purpose: "public_search_warmup",
      });
    } catch {
      alreadyWarm = false;
    }
    if (alreadyWarm) {
      skipped += 1;
      continue;
    }

    attempted += 1;
    try {
      const response = await searchAdsViaSourceResolver(env, query, null, {
        purpose: "public_search_warmup",
        cacheKeyOverride,
        executionContext: ctx ?? null,
      });
      if (
        response.discoveryStatus === "cache_only" ||
        response.cacheStatus === "stale"
      ) {
        skipped += 1;
        continue;
      }
      succeeded += 1;
    } catch (error) {
      failed += 1;
      if (error instanceof CommercialDiscoveryError) {
        continue;
      }
      throw error;
    }
  }

  return { attempted, succeeded, failed, skipped };
}
