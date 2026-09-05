import { resolveCommercialDiscoveryProvider } from "~/lib/ad-source.server";
import type { AutoCompetitorCandidate } from "~/lib/auto-competitor-seed.server";
import {
  resolveRegistrableDomainFromUrl,
  seedAutoCompetitors,
} from "~/lib/auto-competitor-seed.server";
import { buildDiscoveryCacheKey } from "~/lib/discovery-cache.server";
import { readDiscoveryCacheEntryCacheOnly } from "~/lib/discovery-cache.server";
import {
  listWatchlists,
  nowIso,
  upsertDiscoveryCacheEntry,
} from "~/lib/data.server";
import { queryAll as many } from "~/lib/data/d1.server";
import type { AppEnv } from "~/lib/env.server";
import { getWorkspaceBranding } from "~/lib/data/workspace-branding.server";
import { isPaidPlanFamily } from "~/lib/plan-entitlements";
import { getUserPlan } from "~/lib/plan.server";
import { resolveMonitoringFanoutMode } from "~/lib/monitoring-fanout.server";
import { parseSearchInputFromWebsiteField } from "~/lib/search-query";
import { registrableDomainFromLandingPage } from "~/lib/competitor-website";
import type { SearchResponse } from "~/lib/types";

export type { AutoCompetitorCandidate } from "~/lib/auto-competitor-seed.server";

export interface AutoCompetitorResweepOptions {
  /** Limit users processed in one run; production sweeps all. */
  userLimit?: number;
  /** Sweep only this user when set; otherwise sweep all paid users with branding. */
  userId?: string;
}

export interface AutoCompetitorResweepResult {
  users: number;
  withDomain: number;
  scanned: number;
  newlyAppeared: number;
  errors: number;
  skippedReason?: string;
}

export interface AutoCompetitorResweepCustomerResult {
  /** Number of candidates returned by the keyword-expansion probe. */
  scanned: number;
  /** Candidates that are neither watched nor already surfaced. */
  newlyAppeared: AutoCompetitorCandidate[];
}

interface SurfacedCachePayload extends SearchResponse {
  surfacedCandidates: AutoCompetitorCandidate[];
}

const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
const SURFACED_FINGERPRINT_PREFIX = "auto-competitor-surfaced";

/**
 * Stable cache key for the surfaced-candidate set for a given user. This is the
 * phase-1-introduced discovery cache (no new table). The key is scoped by
 * provider, user, and country so a future multi-country resweep cannot collide
 * with the global "all" surfaced set.
 */
function buildSurfacedFingerprint(userId: string) {
  return `${SURFACED_FINGERPRINT_PREFIX}:${userId}`;
}

function buildSurfacedCacheKey(
  provider: string,
  userId: string,
  country: string,
): string {
  return buildDiscoveryCacheKey({
    provider,
    fingerprint: buildSurfacedFingerprint(userId),
    country,
    cursor: null,
  });
}

/**
 * Read the previously-surfaced candidate set from the discovery cache. Returns
 * an empty array when the user has never had a resweep before — the next resweep
 * then treats every candidate as new and stores them honestly.
 */
async function readAutoCompetitorSurfacedCache(
  env: AppEnv,
  userId: string,
  country: string,
): Promise<AutoCompetitorCandidate[]> {
  const provider = resolveCommercialDiscoveryProvider(env);
  const entry = await readDiscoveryCacheEntryCacheOnly(env, {
    provider,
    fingerprint: buildSurfacedFingerprint(userId),
    country,
  });
  if (!entry) {
    return [];
  }
  const payload = (entry.payload ?? {}) as Partial<SurfacedCachePayload>;
  const candidates = Array.isArray(payload.surfacedCandidates)
    ? payload.surfacedCandidates
    : [];
  return candidates.filter(isValidAutoCompetitorCandidate);
}

function isValidAutoCompetitorCandidate(
  value: unknown,
): value is AutoCompetitorCandidate {
  const c = value as Partial<AutoCompetitorCandidate>;
  return (
    typeof c === "object" &&
    c !== null &&
    typeof c.advertiser === "string" &&
    typeof c.provenance === "string" &&
    typeof c.overlapScore === "number" &&
    Array.isArray(c.countries) &&
    Array.isArray(c.matchedKeywords)
  );
}

/**
 * Persist the surfaced-candidate set back to the discovery cache. The surfaced
 * set is the union of previously-surfaced candidates and the current probe
 * result, so a candidate only appears "newly" once.
 */
async function writeAutoCompetitorSurfacedCache(
  env: AppEnv,
  userId: string,
  country: string,
  candidates: AutoCompetitorCandidate[],
) {
  const provider = resolveCommercialDiscoveryProvider(env);
  const cacheKey = buildSurfacedCacheKey(provider, userId, country);
  const deduped = dedupeAutoCompetitorCandidates(candidates);

  const payload: SurfacedCachePayload = {
    ads: [],
    nextCursor: null,
    source: "demo",
    provider,
    cacheStatus: "hit",
    surfacedCandidates: deduped,
  };

  await upsertDiscoveryCacheEntry(env, {
    cacheKey,
    provider,
    routeContext: "scheduled_warmup",
    queryFingerprint: buildSurfacedFingerprint(userId),
    country,
    cursor: null,
    payload,
    fetchedAt: nowIso(),
    expiresAt: FAR_FUTURE,
    browserMsUsed: 0,
  });
}

function dedupeAutoCompetitorCandidates(
  candidates: AutoCompetitorCandidate[],
): AutoCompetitorCandidate[] {
  const seen = new Map<string, AutoCompetitorCandidate>();
  for (const c of candidates) {
    const key = c.registrableDomain ?? c.advertiserPageId ?? c.advertiser;
    if (!key) continue;
    const normalized = key.trim().toLowerCase();
    if (!normalized) continue;
    if (!seen.has(normalized)) {
      seen.set(normalized, c);
    }
  }
  return [...seen.values()];
}

/**
 * Pure diff function. Given the keyword-expansion probe result and the
 * customer's current watchlists (watchedDomains) and already-surfaced set
 * (surfacedDomains), returns only net-new advertisers, with provenance updated
 * to `newly_appeared:`.
 *
 * - A candidate whose registrable domain is already watched is skipped.
 * - A candidate whose registrable domain is already surfaced is skipped.
 * - The result never fabricates candidates: an empty probe returns [].
 */
export function resweepAutoCompetitors(
  seedCandidates: ReadonlyArray<AutoCompetitorCandidate>,
  context: {
    watchedDomains: Set<string>;
    surfacedDomains: Set<string>;
  },
): AutoCompetitorCandidate[] {
  const newlyAppeared: AutoCompetitorCandidate[] = [];
  const seen = new Set<string>();

  for (const candidate of seedCandidates) {
    const domain = candidate.registrableDomain;
    if (!domain) {
      // A candidate without a stable website identity cannot be diffed safely,
      // and must not be re-surfaced indefinitely. Skip it.
      continue;
    }
    const normalized = domain.toLowerCase();
    if (context.watchedDomains.has(normalized)) continue;
    if (context.surfacedDomains.has(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    newlyAppeared.push({
      ...candidate,
      provenance: `newly_appeared: ${candidate.provenance}`,
    });
  }

  return newlyAppeared;
}

/**
 * Re-run the keyword expansion for one customer, diff it against their current
 * watchlists and already-surfaced set, persist the union back, and return only
 * the net-new candidates. This is the unit the scheduled task fans out over.
 */
export async function resweepAutoCompetitorsForCustomer(
  env: AppEnv,
  input: {
    userId: string;
    domain: string;
    country?: string;
  },
): Promise<AutoCompetitorResweepCustomerResult> {
  const country = input.country?.trim() ? input.country : "all";

  const seedCandidates = await seedAutoCompetitors(env, {
    domain: input.domain,
    country,
    userId: input.userId,
  });

  const watchlists = await listWatchlists(env, input.userId);
  const watchedDomains = new Set<string>();
  for (const watchlist of watchlists) {
    if (watchlist.targetType !== "advertiser") continue;
    const domain = resolveRegistrableDomainFromUrl(watchlist.targetId);
    if (domain) {
      watchedDomains.add(domain.toLowerCase());
    }
  }

  const previousSurfaced = await readAutoCompetitorSurfacedCache(
    env,
    input.userId,
    country,
  );
  const surfacedDomains = new Set<string>();
  for (const c of previousSurfaced) {
    if (c.registrableDomain) {
      surfacedDomains.add(c.registrableDomain.toLowerCase());
    }
  }

  const newlyAppeared = resweepAutoCompetitors(seedCandidates, {
    watchedDomains,
    surfacedDomains,
  });

  // Persist the union of previous and current candidates. This keeps the
  // surfaced set stable even when a candidate temporarily disappears from the
  // probe, and prevents it from being surfaced again later.
  const allSurfaced = dedupeAutoCompetitorCandidates([
    ...previousSurfaced,
    ...seedCandidates,
  ]);
  await writeAutoCompetitorSurfacedCache(env, input.userId, country, allSurfaced);

  return { scanned: seedCandidates.length, newlyAppeared };
}

function resolveSelfRegistrableDomain(brandWebsite: string | null): string | null {
  if (!brandWebsite) return null;
  const fromUrl = registrableDomainFromLandingPage(brandWebsite);
  if (fromUrl) return fromUrl;
  const parsed = parseSearchInputFromWebsiteField(brandWebsite);
  return parsed.registrableDomain ?? null;
}

/**
 * Periodic auto-competitor re-sweep. Re-runs the Phase 1 keyword expansion for
 * every paid workspace, diffs the result against current watchlists and the
 * already-surfaced candidate set, and surfaces only net-new advertisers.
 *
 * Runs through the existing monitoring fan-out scheduling surface: it is called
 * from `runScheduledMonitoring` when `includeAutoCompetitorResweep` is true, and
 * it respects `MONITORING_FANOUT_MODE` and paid-tier plan gating. It reuses the
 * Phase 1 discovery cache as the surfaced-candidate store, so no new table is
 * required.
 */
export async function runAutoCompetitorResweep(
  env: AppEnv,
  options: AutoCompetitorResweepOptions = {},
): Promise<AutoCompetitorResweepResult> {
  const result: AutoCompetitorResweepResult = {
    users: 0,
    withDomain: 0,
    scanned: 0,
    newlyAppeared: 0,
    errors: 0,
  };

  if (!env.DB) {
    result.skippedReason = "db_unavailable";
    return result;
  }

  const fanoutMode = resolveMonitoringFanoutMode(env);
  if (fanoutMode === "inline") {
    result.skippedReason = "inline_mode";
    return result;
  }

  let userIds: string[];
  if (options.userId) {
    userIds = [options.userId];
  } else {
    const limit = options.userLimit ?? 10_000;
    const rows = await many<{ user_id: string }>(
      env,
      `
        SELECT DISTINCT user_plan.user_id
        FROM user_plan
        INNER JOIN workspace_branding ON workspace_branding.user_id = user_plan.user_id
        WHERE user_plan.plan != 'free'
          AND workspace_branding.brand_website IS NOT NULL
          AND TRIM(workspace_branding.brand_website) != ''
        ORDER BY user_plan.user_id
        LIMIT ?
      `,
      limit,
    );
    userIds = rows.map((row) => row.user_id);
  }

  result.users = userIds.length;

  for (const userId of userIds) {
    try {
      if (!options.userId) {
        const plan = await getUserPlan(env, userId);
        if (!isPaidPlanFamily(plan)) {
          continue;
        }
      }

      const branding = await getWorkspaceBranding(env, userId);
      const domain = resolveSelfRegistrableDomain(branding.brandWebsite);
      if (!domain) continue;
      result.withDomain += 1;

      const resweep = await resweepAutoCompetitorsForCustomer(env, {
        userId,
        domain,
        country: "all",
      });
      result.scanned += resweep.scanned;
      result.newlyAppeared += resweep.newlyAppeared.length;
    } catch (error) {
      result.errors += 1;
      console.log("auto competitor resweep failed for user", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
