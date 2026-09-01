import {
  hasFreshDiscoveryCacheEntry,
  resolveCommercialDiscoveryProvider,
  searchAdsViaSourceResolver,
} from "~/lib/ad-source.server";
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
