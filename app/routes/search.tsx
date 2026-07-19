import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useLocation,
  useNavigation,
  useRevalidator,
  useRouteLoaderData,
} from "react-router";
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { AdAnglePill } from "~/components/ad-angle-pill";
import { AdLongevityPill } from "~/components/ad-longevity-pill";
import { AdThumb } from "~/components/ad-thumb";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { DashboardShell } from "~/components/dashboard-shell";
import { ResultQuickSave } from "~/components/result-quick-save";
import { SearchAnswerPanel } from "~/components/search-answer-panel";
import { SubmitButton } from "~/components/submit-button";
import { classifyAdRecordAngle } from "~/lib/ad-display";
import { isAdLibraryBackedAd } from "~/lib/ad-source-kind";
import { formatAngleDetail } from "~/lib/angle-display";
import {
  applyWebsiteSearchFallback,
  competitorTrackingLabel,
  emptyCompetitorWebsite,
  hasInvalidCompetitorWebsite,
  normalizeCompetitorWebsiteInput,
  watchlistFingerprint,
} from "~/lib/competitor-website";
import {
  buildSearchParams,
  normalizeSavedQuery,
  parseSearchParams,
} from "~/lib/normalize";
import { defaultCountryForVisitor, ALL_COUNTRIES_VALUE, SUPPORTED_COUNTRIES } from "~/lib/countries";
import { formatAdsFoundLabel, formatOfferDisplay } from "~/lib/analysis-display";
import {
  formatAdvertiserLabel,
  formatCaptureMethodLabel,
  formatLandingPageFormValue,
  formatLandingPageSignalValue,
} from "~/lib/landing-page-display";
import { customerDiscoverySummary } from "~/lib/discovery-customer-copy";
import { buildSearchAnswer, type SearchStealSummary } from "~/lib/search-answer";
import {
  DEFAULT_SEARCH_RESULT_SORT,
  parseSearchResultSort,
  sortAdsForSearchDisplay,
  type SearchResultSort,
} from "~/lib/search-sort";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";
import { normalizeWatchlistTrackingRole } from "~/lib/watchlist-role";
import type { RootLoaderData } from "~/root";
import type { AdRecord, SearchFilters, SearchResponse, WatchlistTrackingRole } from "~/lib/types";

const SEARCH_WARMING_POLL_MS = 5_000;
const SEARCH_WARMING_POLL_LIMIT = 12; // 60s cap

const searchDescription =
  "Preview public competitor ad results before creating an account; sign in to save examples and track offer changes over time. Provider coverage and freshness vary.";
const SEARCH_DELAY_SESSION_KEY = "f9.search.recent-delay.v1";
const SEARCH_DELAY_RECOVERY_WINDOW_MS = 5 * 60 * 1000;

export const links: LinksFunction = () => canonicalLinks("/search");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Search competitor Meta ads free | Five to Nine",
    description: searchDescription,
    pathname: "/search",
  });

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getOptionalSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { listCollections } = await import("~/lib/data.server");
  const runtimeEnv = getEnv(context);
  const { resolveE2EProviderDeny, sanitizeE2EProviderEnv } = await import("~/lib/e2e-provider.server");
  const providerDeny = await resolveE2EProviderDeny(runtimeEnv, request);
  if (providerDeny.failClosed && !providerDeny.enabled) {
    throw new Response("The local release-proof environment is unavailable.", { status: 503 });
  }
  const requestEnv = providerDeny.enabled ? sanitizeE2EProviderEnv(runtimeEnv) : runtimeEnv;
  const e2eSearch = await (await import("~/lib/e2e-search.server")).resolveE2ELocalSearchContext(
    requestEnv,
    request,
  );
  const env = e2eSearch.env;
  const session = await getOptionalSession(env, request);
  const workspaceUserId = session
    ? (await (await import("~/lib/workspace.server")).resolveWorkspace(env, session.user.id)).workspaceUserId
    : null;
  const navFlags = session
    ? {
        showPresenceNav: await (
          await import("~/lib/presence-internal-access.server")
        ).presenceNavVisible(env, workspaceUserId!),
        showOpsNav: (await import("~/lib/env.server")).isOpsUserAllowed(env, session.user.email),
      }
    : { showPresenceNav: false, showOpsNav: false };
  const url = new URL(request.url);
  const visitorCountry = defaultCountryForVisitor(
    (context.cloudflare as { country?: string | null } | undefined)?.country ??
      request.headers.get("cf-ipcountry"),
  );
  const competitorWebsite = normalizeCompetitorWebsiteInput(url.searchParams.get("website") ?? "");
  const parsedInput = parseSearchParams(url.searchParams, { country: visitorCountry });
  const parsed = hasInvalidCompetitorWebsite(competitorWebsite)
    ? parsedInput
    : applyWebsiteSearchFallback(parsedInput, competitorWebsite);
  const trackingRole = normalizeWatchlistTrackingRole(url.searchParams.get("trackingRole"));
  const searchScope = url.searchParams.get("broader") === "1" ? "broader" : "exact";
  const forceLive = canUseCanaryFreshLiveBypass(env, request, url);

  if (hasInvalidCompetitorWebsite(competitorWebsite)) {
    return {
      mode: parsed.mode,
      filters: parsed.filters,
      fingerprint: parsed.fingerprint,
      result: buildIdleSearchResult(),
      selectedAd: null,
      stealSummary: null,
      selectionEnrichmentPending: false,
      collections: [],
      plan: null,
      session,
      competitorWebsite,
      trackingRole,
      inputError: competitorWebsite.error,
      searchScope: "exact" as const,
      displayDomain: null,
      relevanceApplied: false,
      ...navFlags,
    };
  }

  if (!session && request.method.toUpperCase() === "HEAD" && parsed.filters.query) {
    return {
      mode: parsed.mode,
      filters: parsed.filters,
      fingerprint: parsed.fingerprint,
      result: buildIdleSearchResult(),
      selectedAd: null,
      stealSummary: null,
      selectionEnrichmentPending: false,
      collections: [],
      plan: null,
      session,
      competitorWebsite,
      trackingRole,
      inputError: null,
      searchScope: "exact" as const,
      displayDomain: null,
      relevanceApplied: false,
      ...navFlags,
    };
  }

  const customerMetaAdLibraryToken = session && parsed.filters.query && !providerDeny.enabled
    ? await (await import("~/lib/customer-meta.server")).getCustomerMetaAdLibraryToken(env, workspaceUserId!)
    : null;

  // Selecting an ad from already-rendered results reruns this loader with the
  // same query; when the discovery cache can serve that query, the click must
  // not consume the fresh-search rate limit. Fresh searches always charge.
  // Anonymous selections skip entirely (enrichSelected stays false below, so
  // there is no provider spend); signed-in selections still run usage-billed
  // landing-page enrichment, so they consume a dedicated, more generous
  // search-selection bucket instead of going unmetered.
  const selectionServedFromCache =
    Boolean(url.searchParams.get("selected")) && Boolean(parsed.filters.query) && !forceLive
      ? await (await import("~/lib/search-execution.server")).hasWarmSearchCacheEntry({
          env,
          competitorWebsite,
          parsed,
          scope: searchScope,
          cursor: url.searchParams.get("after"),
          customerMetaAdLibraryToken,
        })
      : false;

  if (!session && parsed.filters.query && !forceLive && !selectionServedFromCache) {
    const { enforcePublicSearchRateLimit } = await import("~/lib/rate-limit.server");
    const rateLimitResponse = await enforcePublicSearchRateLimit(request, env, context.cloudflare?.ctx);
    if (rateLimitResponse) {
      throw rateLimitResponse;
    }
  }

  const collections = session ? await listCollections(env, workspaceUserId!) : [];
  let plan: "free" | "scout" | "starter" | "agency" | null = null;
  if (session) {
    try {
      const { getUserPlan } = await import("~/lib/plan.server");
      plan = await getUserPlan(env, workspaceUserId!);
    } catch {
      // Fail OPEN on a transient plan-lookup blip (D1 hiccup or isolated test
      // env without D1): a paying customer must not be degraded to free
      // limits. "starter" is the most permissive non-agency plan — it is used
      // for rate-limit sizing only and, unlike "free", renders no free-plan
      // upsell UI. Real plan gates (saves, watchlists) re-check server-side.
      plan = "starter";
    }
  }

  if (session && parsed.filters.query && !forceLive) {
    const { enforceAuthenticatedSearchRateLimit, enforceSearchSelectionRateLimit } = await import(
      "~/lib/rate-limit.server"
    );
    // FIX-10: warm discovery cache hits must not burn the daily live-search budget.
    // Selection URLs already probed above (do not probe twice). Plain reloads probe once.
    let warmQueryForBudget = selectionServedFromCache;
    if (!selectionServedFromCache && !url.searchParams.get("selected")) {
      warmQueryForBudget = await (
        await import("~/lib/search-execution.server")
      ).hasWarmSearchCacheEntry({
        env,
        competitorWebsite,
        parsed,
        scope: searchScope,
        cursor: url.searchParams.get("after"),
        customerMetaAdLibraryToken,
      });
    }
    if (selectionServedFromCache) {
      const selectionLimit = await enforceSearchSelectionRateLimit(
        request,
        env,
        session.user.id,
        context.cloudflare?.ctx,
      );
      if (selectionLimit) {
        throw selectionLimit;
      }
    } else if (!warmQueryForBudget) {
      const searchLimit = await enforceAuthenticatedSearchRateLimit(
        request,
        env,
        session.user.id,
        context.cloudflare?.ctx,
        plan,
      );
      if (searchLimit) {
        // Prefer an in-product labeled daily/burst limit over a bare JSON 429.
        return {
          mode: parsed.mode,
          filters: parsed.filters,
          fingerprint: parsed.fingerprint,
          result: buildIdleSearchResult(),
          selectedAd: null,
          stealSummary: null,
          selectionEnrichmentPending: false,
          collections,
          plan,
          session,
          competitorWebsite,
          trackingRole,
          inputError:
            "You've hit your live-search limit for your plan. The window refreshes about 24 hours after your earlier searches. Cached results still work — upgrade for more live checks.",
          searchScope: "exact" as const,
          displayDomain: null,
          relevanceApplied: false,
          ...navFlags,
        };
      }
    }
  }

  if (!parsed.filters.query) {
    return {
      mode: parsed.mode,
      filters: parsed.filters,
      fingerprint: parsed.fingerprint,
      result: buildIdleSearchResult(),
      selectedAd: null,
      stealSummary: null,
      selectionEnrichmentPending: false,
      collections,
      plan,
      session,
      competitorWebsite,
      trackingRole,
      inputError: null,
      searchScope: "exact" as const,
      displayDomain: null,
      relevanceApplied: false,
      ...navFlags,
    };
  }

  const { executeSearchWithRelevance } = await import("~/lib/search-execution.server");
  const { shouldApplySearchV2, shouldRunSearchV2Shadow } = await import("~/lib/search-rollout.server");
  const { prepareSearchResultSelection } = await import("~/lib/search-selection.server");

  const useSearchV2 =
    Boolean(competitorWebsite.raw) &&
    (shouldApplySearchV2(env) || shouldRunSearchV2Shadow(env));
  const searchExecution = useSearchV2
    ? await executeSearchWithRelevance({
        env,
        competitorWebsite,
        parsed,
        scope: searchScope,
        cursor: url.searchParams.get("after"),
        forceLive,
        customerMetaAdLibraryToken,
        executionContext: context.cloudflare?.ctx,
      })
    : {
        result: await (
          await import("~/lib/ad-source.server")
        ).searchAdsViaSourceResolver(env, normalizeSavedQuery(parsed.mode, parsed.filters), url.searchParams.get("after"), {
          purpose: "public_search",
          forceLive,
          ...(customerMetaAdLibraryToken ? { customerMetaAdLibraryToken } : {}),
        }),
        query: normalizeSavedQuery(parsed.mode, parsed.filters),
        searchScope,
        displayDomain: competitorWebsite.host,
        relevanceApplied: false,
      };

  const waitUntil = context.cloudflare?.ctx?.waitUntil?.bind(context.cloudflare.ctx);
  const { result: hydratedResult, selectedAd, selectionEnrichmentPending } =
    await prepareSearchResultSelection(
      env,
      searchExecution.result,
      url.searchParams.get("selected"),
      {
        enrichSelected: Boolean(session) && !providerDeny.enabled,
        hydratePersisted: Boolean(session),
        // WP-11: paint base ad immediately; OCR/landing/translation finish via waitUntil.
        ...(typeof waitUntil === "function" ? { waitUntil } : {}),
      },
    );

  // WHAT-TO-STEAL cost design: computed synchronously (small model, ~1-2s) and
  // only for signed-in users on fresh (cache-miss), non-demo searches with >=3
  // ads — a fresh live scrape already costs seconds of Browser Rendering.
  // Cache-hit reloads and ad-selection reruns never call the model: there is no
  // per-search persistence slot without a new migration, so the client keeps
  // the last computed summary for the same search key instead.
  const { buildSearchStealSummary, shouldGenerateStealSummary } = await import(
    "~/lib/search-steal-summary.server"
  );
  const stealSummary = shouldGenerateStealSummary({
    isSignedIn: Boolean(session),
    result: hydratedResult,
  })
    ? await buildSearchStealSummary(env, hydratedResult.ads)
    : null;

  return {
    mode: parsed.mode,
    filters: parsed.filters,
    fingerprint: parsed.fingerprint,
    result: hydratedResult,
    selectedAd,
    stealSummary,
    selectionEnrichmentPending: Boolean(selectionEnrichmentPending),
    collections,
    plan,
    session,
    competitorWebsite,
    trackingRole,
    searchScope: searchExecution.searchScope,
    displayDomain: searchExecution.displayDomain,
    relevanceApplied: searchExecution.relevanceApplied,
    inputError: null,
    ...navFlags,
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const {
    withWorkspace,
    requireWorkspacePlanLimit,
    planLimitExceededActionResult,
  } = await import("~/lib/with-workspace.server");
  const { addAdToCollection, createSavedQuery } = await import("~/lib/data.server");
  const env = getEnv(context);
  const workspace = await withWorkspace(request, env);
  if (!workspace.ok) {
    return workspace.result;
  }
  const { workspaceUserId } = workspace;
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const competitorWebsite = normalizeCompetitorWebsiteInput(
    String(formData.get("competitorWebsite") ?? formData.get("website") ?? ""),
  );
  const trackingRole = normalizeWatchlistTrackingRole(formData.get("trackingRole"));
  const normalizedQuery = applyWebsiteSearchFallback(
    normalizeSavedQuery(
      String(formData.get("mode") ?? "advertiser") === "keyword" ? "keyword" : "advertiser",
      {
        query: String(formData.get("query") ?? ""),
        country:
          String(formData.get("country") ?? "") ||
          defaultCountryForVisitor(
            (context.cloudflare as { country?: string | null } | undefined)?.country ??
              request.headers.get("cf-ipcountry"),
          ),
        platform: String(formData.get("platform") ?? "all"),
        creativeType: String(formData.get("creativeType") ?? "all") as SearchFilters["creativeType"],
        status: String(formData.get("status") ?? "all") as SearchFilters["status"],
        firstSeenFrom: String(formData.get("firstSeenFrom") ?? ""),
        lastSeenFrom: String(formData.get("lastSeenFrom") ?? ""),
      },
    ),
    competitorWebsite,
  );

  if ((intent === "save-query" || intent === "create-watchlist") && hasInvalidCompetitorWebsite(competitorWebsite)) {
    return { ok: false, message: competitorWebsite.error };
  }

  if ((intent === "save-query" || intent === "create-watchlist") && !normalizedQuery.filters.query) {
    return { ok: false, message: "Enter a competitor website before saving or tracking it." };
  }

  if (intent === "save-query") {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) {
      return { ok: false, message: "Give the saved search a name first." };
    }

    await createSavedQuery(env, workspaceUserId, {
      name,
      mode: normalizedQuery.mode,
      filters: normalizedQuery.filters,
    });

    return { ok: true, message: `Saved ${name}.` };
  }

  if (intent === "create-watchlist") {
    const { requireVerifiedEmailForRetention, emailUnverifiedActionResult } = await import(
      "~/lib/email-verification.server"
    );
    const verification = await requireVerifiedEmailForRetention(env, workspaceUserId);
    if (!verification.ok) {
      return emailUnverifiedActionResult();
    }

    const inferredName = (competitorWebsite.displayName ?? normalizedQuery.filters.query) || "Competitor";
    const queryName = String(formData.get("name") ?? "").trim() || `${inferredName} watch`;
    const shouldUseAdvertiserMode = canCreateAdvertiserWatchlist(normalizedQuery);
    const limitGate = await requireWorkspacePlanLimit(env, workspaceUserId, "watchlists", {
      limitMessage: ({ limit }) =>
        limit <= 1
          ? "Free includes 1 watchlist. Upgrade to track more competitors with scheduled scans and digests."
          : "You have reached your competitor tracking limit.",
      upgradePath: "/app/billing?source=search#plans",
    });
    if (!limitGate.ok) {
      return limitGate.result;
    }
    const watchlistLimit = limitGate.planLimit;

    const { createWatchlistWithinLimit } = await import("~/lib/data.server");
    let watchlistResult: Awaited<ReturnType<typeof createWatchlistWithinLimit>> | null = null;
    if (shouldUseAdvertiserMode) {
      watchlistResult = await createWatchlistWithinLimit(env, workspaceUserId, {
        name: queryName,
        targetType: "advertiser",
        targetId: competitorWebsite.normalizedUrl ?? normalizedQuery.filters.query,
        targetFingerprint: watchlistFingerprint(normalizedQuery, competitorWebsite),
        targetLabel: competitorTrackingLabel(competitorWebsite, normalizedQuery.filters.query),
        targetCountry: normalizedQuery.filters.country,
        trackingRole,
      }, watchlistLimit.limit);
    } else {
      const savedQuery = await createSavedQuery(env, workspaceUserId, {
        name: `${queryName} source`,
        mode: normalizedQuery.mode,
        filters: normalizedQuery.filters,
      });

      if (!savedQuery) {
        return { ok: false, message: "Could not prepare this competitor for tracking." };
      }

      watchlistResult = await createWatchlistWithinLimit(env, workspaceUserId, {
        name: queryName,
        targetType: "saved_query",
        targetId: savedQuery.id,
        targetFingerprint: watchlistFingerprint(normalizedQuery, competitorWebsite),
        targetLabel: competitorTrackingLabel(competitorWebsite, normalizedQuery.filters.query) || savedQuery.name,
        targetCountry: normalizedQuery.filters.country,
        trackingRole,
      }, watchlistLimit.limit);
    }

    if (watchlistResult.status === "over_cap") {
      return planLimitExceededActionResult({
        limit: watchlistResult.limit,
        current: watchlistResult.current,
        message:
          watchlistResult.limit <= 1
            ? "Free includes 1 watchlist. Upgrade to track more competitors with scheduled scans and digests."
            : "You have reached your competitor tracking limit.",
        upgradePath: "/app/billing?source=search#plans",
      });
    }

    const watchlist = watchlistResult.watchlist;
    const { queueFirstWatchlistScan } = await import("~/lib/monitoring.server");
    try {
      await queueFirstWatchlistScan(env, context.cloudflare?.ctx, watchlist);
    } catch {
      return {
        ok: false,
        error: "first_scan_dispatch_delayed",
        message:
          "Competitor saved, but the activation scan is delayed. Try tracking it again to resume the same safe scan.",
      };
    }

    if (!watchlist) {
      return { ok: false, message: "Could not create this watchlist." };
    }

    if (!workspace.isMember && !workspace.session.user.onboardedAt) {
      const { completeUserOnboarding } = await import("~/lib/data.server");
      await completeUserOnboarding(env, workspace.session.user.id);
    }

    throw redirect(`/app/watchlists?watchlist=${watchlist.id}`);
  }

  if (intent === "save-to-collection") {
    const collectionId = String(formData.get("collectionId") ?? "");
    const adId = String(formData.get("adId") ?? "").trim();
    const tags = String(formData.get("tags") ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    if (!collectionId || !adId) {
      return { ok: false, message: "Choose a collection and ad before saving." };
    }

    const { listAdsByIds } = await import("~/lib/data.server");
    const ad = (await listAdsByIds(env, [adId]))[0] ?? null;
    if (!ad) {
      return {
        ok: false,
        message: "That ad is no longer available to save. Select it again and retry.",
      };
    }
    if (!isAdLibraryBackedAd(ad)) {
      return {
        ok: false,
        message: "That result is not public Meta Ad Library evidence. Select a live ad result and retry.",
      };
    }
    await addAdToCollection(
      env,
      workspaceUserId,
      collectionId,
      ad,
      String(formData.get("note") ?? "").trim() || null,
      tags,
    );

    return { ok: true, message: `Saved ${ad.advertiser?.trim() || "the ad"} to your collection.` };
  }

  return { ok: false, message: "Unknown search action." };
}

export default function SearchRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const location = useLocation();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const selectedProofRef = useRef<HTMLElement>(null);
  const previousDiscoveryStatusRef = useRef(data.result.discoveryStatus);
  const [recoveredSearchKey, setRecoveredSearchKey] = useState<string | null>(null);
  const [resultSort, setResultSort] = useState<SearchResultSort>(() =>
    parseSearchResultSort(new URLSearchParams(location.search).get("sort")) || DEFAULT_SEARCH_RESULT_SORT,
  );
  const [warmingPollCount, setWarmingPollCount] = useState(0);
  const [selectionEnrichmentRevalidatedFor, setSelectionEnrichmentRevalidatedFor] = useState<
    string | null
  >(null);
  const requestedCursor = new URLSearchParams(location.search).get("after");
  const selectedFromUrl = new URLSearchParams(location.search).get("selected");
  const searchKey = buildSearchAccumulationKey(data);
  const selectionEnrichmentKey = selectedFromUrl
    ? `${searchKey}::${selectedFromUrl}`
    : data.selectedAd?.metaAdId
      ? `${searchKey}::${data.selectedAd.metaAdId}`
      : null;
  const [accumulated, setAccumulated] = useState<SearchAccumulationState>(() =>
    createSearchAccumulationState(searchKey, data.result, data.selectedAd),
  );
  // The loader only computes the steal summary on fresh (cache-miss) searches;
  // keep the last computed one client-side so selecting an ad (a cache-served
  // loader rerun) does not drop it from the panel.
  const [retainedSteal, setRetainedSteal] = useState<{
    searchKey: string;
    summary: SearchStealSummary;
  } | null>(null);
  useEffect(() => {
    if (data.stealSummary) {
      setRetainedSteal({ searchKey, summary: data.stealSummary });
    }
  }, [data.stealSummary, searchKey]);
  const stealSummary =
    data.stealSummary ??
    (retainedSteal?.searchKey === searchKey ? retainedSteal.summary : null);
  const visibleAccumulated = accumulated.searchKey === searchKey
    ? accumulated
    : createSearchAccumulationState(searchKey, data.result, data.selectedAd);
  const visibleResult = visibleAccumulated.result;
  const visibleAds = useMemo(
    () => sortAdsForSearchDisplay(visibleResult.ads, resultSort),
    [visibleResult.ads, resultSort],
  );
  const selectedAd = selectedFromUrl
    ? data.selectedAd ?? visibleAds.find((ad) => ad.metaAdId === selectedFromUrl) ?? null
    : data.selectedAd ?? visibleAccumulated.selectedAd;

  useEffect(() => {
    setAccumulated((previous) => {
      const sameSearch = previous.searchKey === searchKey;
      const shouldMerge = sameSearch && (Boolean(requestedCursor) || Boolean(selectedFromUrl));
      if (!shouldMerge) {
        return createSearchAccumulationState(searchKey, data.result, data.selectedAd);
      }

      return mergeSearchAccumulationState(previous, data.result, {
        requestedCursor,
        selectedAd: data.selectedAd,
      });
    });
  }, [data.result, data.selectedAd, requestedCursor, searchKey, selectedFromUrl]);

  const rootData = useRouteLoaderData("root") as RootLoaderData;
  const creativeTextField = selectedAd?.analysisFields.find((field) => field.fieldKey === "ocr_text");
  const selectedAdAngle = selectedAd ? classifyAdRecordAngle(selectedAd) : null;
  const competitorWebsite = data.competitorWebsite ?? emptyCompetitorWebsite();
  const trackingRole: WatchlistTrackingRole = "competitor";
  const targetNoun = "competitor";
  const currentSearchParams = withTrackingContext(
    buildSearchParams({
      mode: data.mode,
      filters: data.filters,
    }),
    competitorWebsite.raw,
    trackingRole,
  );
  const postSignupPath = competitorWebsite.raw
    ? `/app/onboard?website=${encodeURIComponent(competitorWebsite.raw)}`
    : `/search?${currentSearchParams.toString()}`;
  const signupTrackingPath = `/auth/signup?redirectTo=${encodeURIComponent(postSignupPath)}`;
  const inferredWatchlistName = (competitorWebsite.displayName ?? data.filters.query) || "Competitor";
  const canTrackCurrentCompetitor = Boolean(data.filters.query || competitorWebsite.normalizedUrl) && !data.inputError;
  const discoverySummary = formatDiscoverySummary(visibleResult);
  const hasSearchQuery = Boolean(data.filters.query || competitorWebsite.raw);
  const landingPageCount = visibleAds.filter((ad) => ad.landingPage || ad.landingPageUrl).length;
  const displayDomain = data.displayDomain ?? competitorWebsite.host ?? competitorWebsite.raw;
  const isDomainSearch = Boolean(displayDomain && competitorWebsite.normalizedUrl);
  const isBroaderScope = data.searchScope === "broader";
  const isSearchWarming = visibleResult.discoveryProgress === "warming";
  const formatFilterApproximate =
    (data.filters.creativeType === "video" || data.filters.creativeType === "carousel") &&
    (visibleResult.provider === "meta_library_browser" || visibleResult.source === "meta_library_browser");
  const competitorWatchLabel = displayDomain || "this competitor";
  const signupCtaBody = `Create a free account and we'll keep watching ${competitorWatchLabel} — first scan runs immediately, and you'll get an email when their ads, offer, or landing page changes.`;
  const retrySearchPath = `${location.pathname}${location.search}${location.hash}`;
  const scopedSearchParams = withSearchScope(currentSearchParams, isBroaderScope ? "broader" : "exact");

  // Auto-revalidate while commercial discovery is warming (5s × 12 = 60s cap).
  useEffect(() => {
    if (!isSearchWarming) {
      setWarmingPollCount(0);
      return;
    }
    if (warmingPollCount >= SEARCH_WARMING_POLL_LIMIT) {
      return;
    }
    const timer = setTimeout(() => {
      setWarmingPollCount((count) => count + 1);
      if (revalidator.state === "idle") {
        revalidator.revalidate();
      }
    }, SEARCH_WARMING_POLL_MS);
    return () => clearTimeout(timer);
  }, [isSearchWarming, warmingPollCount, revalidator]);

  useEffect(() => {
    // Reset warming poll budget when the query identity changes.
    setWarmingPollCount(0);
  }, [searchKey]);

  // WP-11: single revalidation ~4s after deferred selection enrichment starts.
  // FIX-13: only one shot per selection key — if still pending after that,
  // UI falls back to "Not detected…" instead of endless "Analyzing creative…".
  useEffect(() => {
    if (!data.selectionEnrichmentPending || !selectionEnrichmentKey) {
      return;
    }
    if (selectionEnrichmentRevalidatedFor === selectionEnrichmentKey) {
      return;
    }
    const timer = setTimeout(() => {
      setSelectionEnrichmentRevalidatedFor(selectionEnrichmentKey);
      if (revalidator.state === "idle") {
        revalidator.revalidate();
      }
    }, 4_000);
    return () => clearTimeout(timer);
  }, [
    data.selectionEnrichmentPending,
    selectionEnrichmentKey,
    selectionEnrichmentRevalidatedFor,
    revalidator,
  ]);
  // After the one-shot revalidation, do not keep advertising in-flight analysis.
  const selectionEnrichmentUiPending =
    Boolean(data.selectionEnrichmentPending) &&
    selectionEnrichmentRevalidatedFor !== selectionEnrichmentKey;
  const nextCursor = visibleResult.nextCursor;
  const retryingCursor = visibleAccumulated.retryCursor;
  const loadMoreParams = nextCursor
    ? appendCursor(scopedSearchParams, nextCursor, selectedAd?.metaAdId ?? null)
    : null;
  const isLoadingMore = Boolean(
    loadMoreParams &&
      navigation.state !== "idle" &&
      navigation.location?.pathname === "/search" &&
      new URLSearchParams(navigation.location.search).get("after") === nextCursor,
  );
  const recoveredFromDiscoveryFailure =
    isDelayedDiscoveryStatus(previousDiscoveryStatusRef.current) &&
    !isDelayedDiscoveryStatus(visibleResult.discoveryStatus);
  const resultsAnnouncement = formatSearchResultsAnnouncement(visibleResult, {
    isLoading: isLoadingMore,
    addedCount: visibleAccumulated.addedCount,
    retryCursor: visibleAccumulated.retryCursor,
    recovered: recoveredFromDiscoveryFailure || recoveredSearchKey === searchKey,
  });
  const broaderSearchParams = withTrackingContext(
    buildSearchParams({
      mode: data.mode,
      filters: data.filters,
    }),
    competitorWebsite.raw,
    trackingRole,
  );
  broaderSearchParams.set("broader", "1");
  const searchAnswer = hasSearchQuery && !data.inputError && !isSearchWarming
    ? buildSearchAnswer({
      result: visibleResult,
      displayDomain,
      isDomainSearch: isDomainSearch && data.relevanceApplied,
      isBroaderScope,
    })
    : null;

  useEffect(() => {
    if (new URLSearchParams(location.search).has("selected")) {
      selectedProofRef.current?.focus();
    }
  }, [location.search]);

  useEffect(() => {
    const now = Date.now();
    let recentDelay = false;
    if (typeof window !== "undefined") {
      try {
        recentDelay = hasRecentSearchDelay(
          window.sessionStorage.getItem(SEARCH_DELAY_SESSION_KEY),
          now,
        );
      } catch {
        recentDelay = false;
      }
    }
    setRecoveredSearchKey((currentRecoveryKey) =>
      resolveRecoveredSearchKey({
        currentDiscoveryStatus: visibleResult.discoveryStatus,
        currentRecoveryKey,
        previousDiscoveryStatus: recentDelay
          ? "degraded"
          : previousDiscoveryStatusRef.current,
        searchKey,
      }),
    );
    previousDiscoveryStatusRef.current = visibleResult.discoveryStatus;
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem(
          SEARCH_DELAY_SESSION_KEY,
          JSON.stringify({
            delayed: isDelayedDiscoveryStatus(visibleResult.discoveryStatus),
            observedAt: now,
          }),
        );
      } catch {
        // Search and retry remain available when browser storage is blocked.
      }
    }
  }, [searchKey, visibleResult.discoveryStatus]);

  return (
    <DashboardShell
      accountDetail={rootData.session ? "Saved searches and watches" : "Find competitor ads"}
      accountLabel={rootData.session ? "Workspace" : "Search"}
      accountTitle="Five to Nine"
      isPublic={!rootData.session}
      pageClassName="f9-search-page"
      railNote={
        visibleAds.length > 0 ? (
          <div className="f9-cursor-rail-note">
            <span>Saved evidence</span>
            <strong>
              {landingPageCount}/{visibleAds.length}
            </strong>
            <small>From this search</small>
          </div>
        ) : null
      }
      showOpsNav={data.showOpsNav}
      showPresenceNav={data.showPresenceNav}
      userEmail={rootData.session?.user.email}
      userName={rootData.session?.user.name}
    >
          <section className="f9-search-command" aria-labelledby="search-command-title">
            <div className="f9-search-command-head">
              <h1 id="search-command-title">Find competitor ads</h1>
            </div>

            <Form className="f9-search-command-form" method="get">
              <input name="mode" type="hidden" value="advertiser" />
              <input name="trackingRole" type="hidden" value="competitor" />
              <label className="f9-search-field">
                <span>Competitor website</span>
                <input
                  aria-invalid={Boolean(data.inputError)}
                  aria-describedby="search-command-hint"
                  autoComplete="url"
                  defaultValue={competitorWebsite.raw}
                  inputMode="url"
                  name="website"
                  placeholder="https://nykaa.com"
                  spellCheck={false}
                  type="text"
                />
              </label>
              <details className="f9-search-refine-disclosure" open={!hasSearchQuery}>
                <summary>Refine search</summary>
                <div className="f9-search-refine" role="group" aria-label="Search filters">
                <label className="f9-search-field">
                  <span>Country</span>
                  <select defaultValue={data.filters.country} name="country">
                    <option value={ALL_COUNTRIES_VALUE}>All countries</option>
                    {SUPPORTED_COUNTRIES.map((country) => (
                      <option key={country.code} value={country.name}>
                        {country.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="f9-search-field">
                  <span>Platform</span>
                  <select defaultValue={data.filters.platform} name="platform">
                    <option value="all">All platforms</option>
                    <option value="Facebook">Facebook</option>
                    <option value="Instagram">Instagram</option>
                    <option value="Audience Network">Audience Network</option>
                    <option value="Messenger">Messenger</option>
                  </select>
                </label>
                <label className="f9-search-field">
                  <span>Creative</span>
                  <select defaultValue={data.filters.creativeType} name="creativeType">
                    <option value="all">All creatives</option>
                    <option value="image">Image</option>
                    <option value="video">Video</option>
                    <option value="carousel">Carousel</option>
                  </select>
                </label>
                <label className="f9-search-field">
                  <span>Status</span>
                  <select defaultValue={data.filters.status} name="status">
                    <option value="all">All statuses</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
                </div>
              </details>
              <div className="f9-search-actions">
                <SubmitButton className="f9-primary-button" getAction="/search" pendingLabel="Searching…">
                  See ads
                </SubmitButton>
              </div>
            </Form>
            <p className="f9-search-command-hint" id="search-command-hint">
              {data.inputError ?? (rootData.session
                ? "Paste one competitor website."
                : "Paste one competitor website. No account needed.")}
            </p>
            {canTrackCurrentCompetitor && rootData.session ? (
              <div className="f9-search-retention">
                <Form className="f9-quick-track-form" method="post">
                  <input name="intent" type="hidden" value="create-watchlist" />
                  <SearchStateFields
                    competitorWebsite={competitorWebsite.raw}
                    filters={data.filters}
                    mode={data.mode}
                    trackingRole={trackingRole}
                  />
                  <input name="name" type="hidden" value={`${inferredWatchlistName} watch`} />
                  <SubmitButton className="f9-secondary-button" intent="create-watchlist" pendingLabel="Creating…">
                    Track this {targetNoun}
                  </SubmitButton>
                </Form>
                <Form className="f9-save-query-form" method="post">
                  <input name="intent" type="hidden" value="save-query" />
                  <SearchStateFields
                    competitorWebsite={competitorWebsite.raw}
                    filters={data.filters}
                    mode={data.mode}
                    trackingRole={trackingRole}
                  />
                  <label className="f9-search-field">
                    <span>Save search as</span>
                    <input
                      autoComplete="off"
                      defaultValue={inferredWatchlistName}
                      name="name"
                      placeholder="Competitor research"
                      type="text"
                    />
                  </label>
                  <SubmitButton className="f9-secondary-button" intent="save-query" pendingLabel="Saving…">
                    Save search
                  </SubmitButton>
                </Form>
              </div>
            ) : null}
          </section>

      <section className="f9-search-workspace">
        <div className="f9-container">
          {actionData?.message ? (
            <div
              aria-live={actionData.ok ? "polite" : "assertive"}
              className={`f9-message ${actionData.ok ? "is-success" : "is-error"}`}
              role={actionData.ok ? "status" : "alert"}
            >
              <p>
                {actionData.message}
                {"error" in actionData && actionData.error === "plan_limit_exceeded" ? (
                  <>
                    {" "}
                    <Link to="/app/billing?source=search#plans">View plans</Link> to raise the limit.
                  </>
                ) : null}
              </p>
            </div>
          ) : null}

          {data.inputError ? (
            <div aria-live="assertive" className="f9-message is-error" role="alert">
              <p>{data.inputError}</p>
            </div>
          ) : null}

          {hasSearchQuery ? (
            <>
          <div className="f9-search-grid">
            {selectedAd ? (
              <section
                aria-labelledby="selected-proof-title"
                className="f9-proof-summary"
                id="selected-proof"
                ref={selectedProofRef}
                tabIndex={-1}
              >
                <div className="f9-panel-head">
                  <div>
                    <span>Selected proof</span>
                    <h2 id="selected-proof-title">{formatAdvertiserLabel(selectedAd.advertiser)}</h2>
                    <AdLongevityPill ad={selectedAd} />
                  </div>
                  <em className={selectedAd.active ? "is-active" : ""}>
                    {selectedAd.active ? "Active" : "Inactive"}
                  </em>
                </div>
                <p className="f9-proof-provenance">
                  <strong>{formatSearchSourceLabel(visibleResult)}</strong>
                  <span>{formatSearchFreshnessLabel(visibleResult)}</span>
                  <span>{formatProofCaptureLabel(selectedAd)}</span>
                </p>
                <div className="f9-detail-hero">
                  <div className="f9-ad-thumb-row">
                    <AdThumb ad={selectedAd} />
                    <div>
                      <h3>{selectedAd.previewHeadline}</h3>
                      <p>{formatAdDetailBody(selectedAd)}</p>
                    </div>
                  </div>
                </div>
                {selectedAd.domainMatch?.reason ? <p>{selectedAd.domainMatch.reason}</p> : null}
                <Link className="f9-secondary-button" to="#selected-proof-detail">
                  Review full evidence
                </Link>
              </section>
            ) : null}
            <section
              className="f9-results-panel"
              data-f9-result-cache-status={visibleResult.cacheStatus ?? undefined}
              data-f9-result-empty-reason={visibleResult.discoveryEmptyReason ?? undefined}
              data-f9-result-source={visibleResult.provider ?? visibleResult.source}
            >
              <div className="f9-panel-head">
                <div>
                  <span>Results</span>
                  <h2>
                    {formatResultsPanelTitle(visibleResult, {
                      displayDomain,
                      isDomainSearch,
                      isBroaderScope,
                      relevanceApplied: data.relevanceApplied,
                    })}
                  </h2>
                  {isDomainSearch && data.relevanceApplied && !isBroaderScope ? (
                    <small>{`Verified ads linked to ${displayDomain}`}</small>
                  ) : null}
                  {isDomainSearch && isBroaderScope ? (
                    <small>{`Broader matches related to ${displayDomain}`}</small>
                  ) : null}
                </div>
                {visibleAds.length > 1 ? (
                  <label className="f9-search-field f9-result-sort">
                    <span className="f9-sr-only">Sort results</span>
                    <select
                      aria-label="Sort results"
                      value={resultSort}
                      onChange={(event) => setResultSort(parseSearchResultSort(event.target.value))}
                    >
                      <option value="active_first">Active first</option>
                      <option value="longest_running">Longest running</option>
                      <option value="newest">Newest</option>
                    </select>
                  </label>
                ) : null}
                {loadMoreParams ? (
                  <Form
                    aria-label={retryingCursor ? "Retry search results" : "Load more search results"}
                    className="f9-load-more-form"
                    method="get"
                    action="/search"
                  >
                    <SearchQueryFields params={loadMoreParams} />
                    <SubmitButton
                      className="f9-secondary-button"
                      getAction="/search"
                      match={{ after: loadMoreParams.get("after") ?? "" }}
                      pendingLabel="Loading…"
                    >
                      {retryingCursor ? "Retry" : "Load more"}
                    </SubmitButton>
                  </Form>
                ) : null}
              </div>

              <div aria-live="polite" className="f9-sr-only" role="status">
                {resultsAnnouncement}
              </div>

              {searchAnswer ? (
                <SearchAnswerPanel answer={searchAnswer} steal={stealSummary} />
              ) : null}

              {!data.session ? (
                <div className="f9-search-signup-cta">
                  <div>
                    <strong>
                      {visibleAds.length > 0
                        ? "Keep this competitor under watch"
                        : "Keep checking this competitor"}
                    </strong>
                    <p>{signupCtaBody}</p>
                  </div>
                  <Link className="f9-primary-button" to={signupTrackingPath}>
                    Create account
                  </Link>
                </div>
              ) : null}

              {formatFilterApproximate ? (
                <div className="f9-discovery-banner" role="status">
                  <p>Format filters are approximate for this source</p>
                </div>
              ) : null}

              {discoverySummary && visibleAds.length > 0 ? (
                <div className="f9-discovery-banner">
                  <p>{discoverySummary}</p>
                </div>
              ) : null}

              <div className="f9-results-list">
                {visibleAds.length > 0 ? (
                  visibleAds.map((ad) => (
                    <div className="f9-result-card-wrap" key={ad.metaAdId}>
                    <Link
                      className={`f9-result-card ${selectedAd?.metaAdId === ad.metaAdId ? "is-active" : ""}`}
                      to={`/search?${(requestedCursor
                        ? appendCursor(scopedSearchParams, requestedCursor, ad.metaAdId)
                        : withSelected(scopedSearchParams, ad.metaAdId)
                      ).toString()}#selected-proof`}
                    >
                      <AdThumb ad={ad} />
                      <div className="f9-result-card-body">
                        <div>
                          <span>{formatAdvertiserLabel(ad.advertiser)}</span>
                          <h3>{ad.previewHeadline}</h3>
                          <div className="f9-result-card-pills">
                            {ad.source === "demo" ? (
                              <span className="f9-longevity-pill is-sample">Sample</span>
                            ) : null}
                            <AdLongevityPill ad={ad} />
                            {ad.variantCount && ad.variantCount > 1 ? (
                              <span className="f9-longevity-pill">{`×${ad.variantCount} variants`}</span>
                            ) : null}
                            <AdAnglePill ad={ad} />
                          </div>
                        </div>
                        <p>{formatResultCardSummary(ad)}</p>
                        {ad.domainMatch?.reason ? <strong>{ad.domainMatch.reason}</strong> : null}
                        <small>
                          {formatOfferDisplay(ad.offer)} · {ad.destinationType} · {ad.languageLabel}
                        </small>
                        <em>{ad.format}</em>
                      </div>
                    </Link>
                    {data.session && ad.source !== "demo" ? (
                      <ResultQuickSave
                        adId={ad.metaAdId}
                        advertiser={ad.advertiser}
                        collections={data.collections}
                        plan={data.plan}
                      />
                    ) : null}
                    </div>
                  ))
                ) : (
                  <div className="f9-empty-state">
                    {isSearchWarming ? (
                      <div aria-live="polite" role="status">
                        <h3>Checking the Ad Library now</h3>
                        <p>Usually under a minute — we will refresh automatically.</p>
                      </div>
                    ) : !searchAnswer ? (
                      <>
                        <h3>
                          {formatEmptyResultHeadline(visibleResult, {
                            displayDomain,
                            isDomainSearch,
                            isBroaderScope,
                            relevanceApplied: data.relevanceApplied,
                          })}
                        </h3>
                        <p>
                          {isDelayedDiscoveryStatus(visibleResult.discoveryStatus)
                            ? discoverySummary ?? "Fresh checks are delayed, so coverage may be incomplete."
                            : isDomainSearch && data.relevanceApplied && !isBroaderScope
                            ? "We couldn't confirm any ads whose advertiser or landing page is connected to this website."
                            : discoverySummary ?? "Try another competitor website."}
                        </p>
                      </>
                    ) : null}
                    {isSearchWarming ? (
                      <div className="f9-search-empty-actions">
                        <Link className="f9-secondary-button" to={retrySearchPath}>
                          Retry this search
                        </Link>
                        <Link className="f9-secondary-button" to="/search">
                          Try another domain
                        </Link>
                      </div>
                    ) : isDomainSearch && !isBroaderScope ? (
                      <div className="f9-search-empty-actions">
                        {rootData.session ? (
                          <Form className="f9-quick-track-form" method="post">
                            <input name="intent" type="hidden" value="create-watchlist" />
                            <SearchStateFields
                              competitorWebsite={competitorWebsite.raw}
                              filters={data.filters}
                              mode={data.mode}
                              trackingRole={trackingRole}
                            />
                            <input name="name" type="hidden" value={`${inferredWatchlistName} watch`} />
                            <SubmitButton className="f9-secondary-button" intent="create-watchlist" pendingLabel="Creating…">
                              Track this {targetNoun}
                            </SubmitButton>
                          </Form>
                        ) : null}
                        <Link className="f9-secondary-button" to={`/search?${broaderSearchParams.toString()}`}>
                          Search broader matches for “{displayDomain.split(".")[0] ?? displayDomain}”
                        </Link>
                        <Link className="f9-secondary-button" to="/search">
                          Try another domain
                        </Link>
                        <Link className="f9-secondary-button" to="/app/watchlists">
                          View monitoring setup
                        </Link>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </section>

            <aside className="f9-proof-detail" id="selected-proof-detail" tabIndex={-1}>
              {selectedAd ? (
                <>
                  <div className="f9-panel-head">
                    <div>
                      <span>Ad details</span>
                      <h2>{formatAdvertiserLabel(selectedAd.advertiser)}</h2>
                      <AdLongevityPill ad={selectedAd} />
                    </div>
                    <em className={selectedAd.active ? "is-active" : ""}>
                      {selectedAd.active ? "Active" : "Inactive"}
                    </em>
                  </div>

                  <p className="f9-proof-provenance">
                    <strong>{formatSearchSourceLabel(visibleResult)}</strong>
                    <span>{formatSearchFreshnessLabel(visibleResult)}</span>
                    <span>{formatProofCaptureLabel(selectedAd)}</span>
                  </p>

                  <div className="f9-detail-hero">
                    <div className="f9-ad-thumb-row">
                      <AdThumb ad={selectedAd} />
                      <div>
                        <h3>{selectedAd.previewHeadline}</h3>
                        <p>{formatAdDetailBody(selectedAd)}</p>
                      </div>
                    </div>
                  </div>

                  <dl className="f9-detail-grid">
                    <DetailRow label="Hook" value={selectedAd.hook} />
                    {selectedAdAngle ? (
                      <DetailRow label="Angle" value={formatAngleDetail(selectedAdAngle)} />
                    ) : null}
                    <DetailRow label="Offer" value={formatOfferDisplay(selectedAd.offer)} />
                    <DetailRow label="CTA" value={selectedAd.cta} />
                    <DetailRow label="Format" value={selectedAd.format} />
                    <DetailRow label="Language" value={selectedAd.languageLabel} />
                    <DetailRow label="Destination" value={selectedAd.destinationType} />
                  </dl>

                  <div className="f9-proof-block">
                    <span>Text in the ad</span>
                    <p>
                      {creativeTextField
                        ? formatLandingPageSignalValue(creativeTextField.fieldValue)
                        : selectionEnrichmentUiPending
                          ? "Analyzing creative…"
                          : formatLandingPageSignalValue(null)}
                    </p>
                    <small>
                      {creativeTextField
                        ? "Read from the ad creative when available."
                        : selectionEnrichmentUiPending
                          ? "Reading the ad creative now — this updates in a few seconds."
                          : "Not detected from the ad snapshot yet."}
                    </small>
                  </div>

                  <div className="f9-proof-block">
                    <span>Landing page</span>
                    <h3>
                      {selectedAd.landingPage?.rawHeadline ??
                        (selectionEnrichmentUiPending
                          ? "Analyzing creative…"
                          : "Headline not captured yet")}
                    </h3>
                    <dl className="f9-detail-grid">
                      <DetailRow
                        label="Primary CTA"
                        value={formatLandingPageSignalValue(selectedAd.landingPage?.ctaText)}
                      />
                      <DetailRow
                        label="Visible price/offer"
                        value={formatLandingPageSignalValue(selectedAd.landingPage?.priceText)}
                      />
                      <DetailRow
                        label="Form present"
                        value={formatLandingPageFormValue(selectedAd.landingPage?.formPresent)}
                      />
                      <DetailRow
                        label="Page check"
                        value={formatCaptureMethodLabel(selectedAd.landingPage?.captureMethod)}
                      />
                    </dl>
                    {selectedAd.landingPageUrl ? (
                      <a href={selectedAd.landingPageUrl} rel="noreferrer" target="_blank">
                        {selectedAd.landingPageUrl}
                      </a>
                    ) : (
                      <small>No landing page URL detected.</small>
                    )}
                  </div>

                  <div className="f9-proof-block">
                    <span>Why this may matter</span>
                    <p>{selectedAd.researchSummary}</p>
                  </div>

                  {data.session && data.plan === "free" ? (
                    <div className="f9-side-note">
                      <p>Saving ads to a collection starts on Scout.</p>
                      <Link className="f9-primary-button" to="/app/billing?source=search#plans">
                        View plans
                      </Link>
                    </div>
                  ) : data.session && data.collections.length > 0 ? (
                    <Form className="f9-save-stack" method="post">
                      <input name="intent" type="hidden" value="save-to-collection" />
                      <input name="adId" type="hidden" value={selectedAd.metaAdId} />
                      <label className="f9-field">
                        <span>Collection</span>
                        <select name="collectionId" required>
                          {data.collections.map((collection) => (
                            <option key={collection.id} value={collection.id}>
                              {collection.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="f9-field">
                        <span>Note</span>
                        <textarea name="note" placeholder="Why this ad matters" rows={3} />
                      </label>
                      <label className="f9-field">
                        <span>Tags</span>
                        <input name="tags" placeholder="discount, COD, creator-led" />
                      </label>
                      <SubmitButton className="f9-primary-button" intent="save-to-collection" pendingLabel="Saving…">
                        Save to collection
                      </SubmitButton>
                    </Form>
                  ) : data.session ? (
                    <div className="f9-side-note">
                      <p>Create a collection first, then save ads from search.</p>
                      <Link className="f9-secondary-button" to="/app/collections">
                        Open collections
                      </Link>
                    </div>
                  ) : (
                    <div className="f9-side-note">
                      <p>{signupCtaBody}</p>
                      <Link className="f9-primary-button" to={signupTrackingPath}>
                        Create account to track this competitor
                      </Link>
                    </div>
                  )}
                </>
              ) : (
                <div className="f9-empty-state">
                  <h2>No ad selected</h2>
                  <p>Run a search and select one result to inspect the offer and landing page.</p>
                </div>
              )}
            </aside>
          </div>
            </>
          ) : null}
        </div>
      </section>
    </DashboardShell>
  );
}

function buildIdleSearchResult(): SearchResponse {
  return {
    ads: [],
    nextCursor: null,
    source: "demo",
    cacheStatus: "none",
    discoveryStatus: "disabled",
    discoverySummary: null,
    discoveryFailureClass: null,
  };
}

export interface SearchAccumulationState {
  searchKey: string;
  result: SearchResponse;
  selectedAd: AdRecord | null;
  addedCount: number;
  retryCursor: string | null;
}

export function buildSearchAccumulationKey(data: {
  fingerprint: string;
  mode: string;
  searchScope: string;
  competitorWebsite?: { normalizedUrl?: string | null; raw?: string | null } | null;
}) {
  return JSON.stringify({
    fingerprint: data.fingerprint,
    mode: data.mode,
    searchScope: data.searchScope,
    website: data.competitorWebsite?.normalizedUrl ?? data.competitorWebsite?.raw ?? null,
  });
}

export function createSearchAccumulationState(
  searchKey: string,
  result: SearchResponse,
  selectedAd: AdRecord | null,
): SearchAccumulationState {
  return {
    searchKey,
    result,
    selectedAd,
    addedCount: 0,
    retryCursor: null,
  };
}

export function mergeSearchAccumulationState(
  previous: SearchAccumulationState,
  incoming: SearchResponse,
  input: { requestedCursor: string | null; selectedAd: AdRecord | null },
): SearchAccumulationState {
  if (input.requestedCursor && isDelayedDiscoveryStatus(incoming.discoveryStatus) && incoming.ads.length === 0) {
    return {
      ...previous,
      result: {
        ...incoming,
        ads: previous.result.ads,
        nextCursor: input.requestedCursor,
      },
      selectedAd: input.selectedAd ?? previous.selectedAd,
      addedCount: 0,
      retryCursor: input.requestedCursor,
    };
  }

  const priorIds = new Set(previous.result.ads.map((ad) => ad.metaAdId));
  const mergedAds = new Map(previous.result.ads.map((ad) => [ad.metaAdId, ad]));
  for (const ad of incoming.ads) {
    mergedAds.set(ad.metaAdId, ad);
  }

  return {
    searchKey: previous.searchKey,
    result: { ...incoming, ads: Array.from(mergedAds.values()) },
    selectedAd: input.selectedAd ?? previous.selectedAd,
    addedCount: incoming.ads.filter((ad) => !priorIds.has(ad.metaAdId)).length,
    retryCursor: null,
  };
}

function formatSearchSourceLabel(result: SearchResponse) {
  if (result.provider === "meta_library_browser" || result.source === "meta_library_browser") {
    return "Source: Meta Ad Library visual check";
  }
  if (result.provider === "meta_api" || result.source === "meta_api") {
    return "Source: Meta Ad Library API";
  }
  if (result.source === "demo") {
    return "Source: sample data";
  }
  return "Source: search result";
}

function formatSearchFreshnessLabel(result: SearchResponse) {
  if (isDelayedDiscoveryStatus(result.discoveryStatus)) return "Fresh check delayed";
  if (result.cacheStatus === "hit") return "Recent cached result";
  if (result.cacheStatus === "stale") return "Older cached result";
  if (result.cacheStatus === "miss") return "Fresh result";
  return "Freshness unavailable";
}

function formatProofCaptureLabel(ad: AdRecord) {
  if (ad.landingPage?.capturedAt) {
    const capturedAt = new Date(ad.landingPage.capturedAt);
    if (!Number.isNaN(capturedAt.getTime())) {
      return `Landing page checked ${capturedAt.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })}`;
    }
  }
  return ad.landingPageUrl
    ? "Landing page not captured yet"
    : "No landing-page destination available";
}

function SearchStateFields({
  competitorWebsite = "",
  mode,
  filters,
  trackingRole,
}: {
  competitorWebsite?: string;
  mode: "advertiser" | "keyword";
  filters: SearchFilters;
  trackingRole: WatchlistTrackingRole;
}) {
  return (
    <>
      <input name="competitorWebsite" type="hidden" value={competitorWebsite} />
      <input name="trackingRole" type="hidden" value={trackingRole} />
      <input name="mode" type="hidden" value={mode} />
      <input name="query" type="hidden" value={filters.query} />
      <input name="country" type="hidden" value={filters.country} />
      <input name="platform" type="hidden" value={filters.platform} />
      <input name="creativeType" type="hidden" value={filters.creativeType} />
      <input name="status" type="hidden" value={filters.status} />
      <input name="firstSeenFrom" type="hidden" value={filters.firstSeenFrom} />
      <input name="lastSeenFrom" type="hidden" value={filters.lastSeenFrom} />
    </>
  );
}

function SearchQueryFields({ params }: { params: URLSearchParams }) {
  return Array.from(params.entries()).map(([name, value], index) => (
    <input key={`${name}-${value}-${index}`} name={name} type="hidden" value={value} />
  ));
}

function canUseCanaryFreshLiveBypass(env: { CANARY_BYPASS_TOKEN?: string }, request: Request, url: URL) {
  const configuredToken = env.CANARY_BYPASS_TOKEN?.trim();
  if (!configuredToken || url.searchParams.get("fresh") !== "live") {
    return false;
  }

  return request.headers.get("x-0509-canary-token") === configuredToken;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="f9-detail-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatResultCardSummary(
  ad: Pick<AdRecord, "advertiser" | "body" | "hook" | "offer" | "previewHeadline" | "previewSubhead">,
) {
  return (
    firstDistinctDisplayText(
      [ad.hook, ad.body, ad.previewSubhead, ad.offer],
      [ad.previewHeadline, ad.advertiser],
    ) ?? ad.offer
  );
}

function formatAdDetailBody(ad: Pick<AdRecord, "body" | "hook" | "previewHeadline" | "previewSubhead">) {
  return (
    firstDistinctDisplayText(
      [ad.body, ad.hook, ad.previewSubhead],
      [ad.previewHeadline],
    ) ?? ad.previewHeadline
  );
}

function firstDistinctDisplayText(
  candidates: Array<string | null | undefined>,
  existing: Array<string | null | undefined>,
) {
  const seen = new Set(existing.map(normalizeDisplayText).filter(Boolean));

  for (const candidate of candidates) {
    const cleaned = cleanDisplayText(candidate);
    const normalized = normalizeDisplayText(cleaned);
    if (!cleaned || !normalized || seen.has(normalized)) {
      continue;
    }
    return cleaned;
  }

  return null;
}

function cleanDisplayText(value: string | null | undefined) {
  const lines = String(value ?? "")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const line of lines) {
    const normalized = normalizeDisplayText(line);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(line);
  }

  return unique.join("\n");
}

function normalizeDisplayText(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function formatDiscoverySummary(result: SearchResponse) {
  if (!result.discoverySummary) {
    return null;
  }

  if (result.ads.length > 0 && /no cached results are available/i.test(result.discoverySummary)) {
    return "Live ad checks are temporarily delayed, so we're showing your most recent results. We'll retry automatically.";
  }

  if (/rate limited|degraded/i.test(result.discoverySummary)) {
    return customerDiscoverySummary(result.discoverySummary);
  }

  if (/API fallback/i.test(result.discoverySummary)) {
    const fallbackUnavailable =
      isDelayedDiscoveryStatus(result.discoveryStatus) ||
      Boolean(result.discoveryFailureClass) ||
      /failed/i.test(result.discoverySummary);

    if (fallbackUnavailable) {
      return "Fresh visual checks are delayed and no alternate results are available.";
    }

    if (result.ads.length === 0) {
      return "Fresh visual checks are delayed; alternate Meta checks found no ads.";
    }

    return "Fresh visual checks are delayed; showing alternate Meta ad results.";
  }

  return result.discoverySummary
    .replace(/Commercial discovery/gi, "Competitor ad checks")
    .replace(/commercial discovery/gi, "competitor ad checks")
    .replace(/competitor ad checks is already warming this query\.?/gi, "We are checking this competitor now.")
    .replace(/query/gi, "competitor")
    .replace(/Browser Run/gi, "visual checks")
    .replace(/API fallback/gi, "alternate Meta ad results")
    .replace(/cached live results/gi, "recent results")
    .replace(/cached results/gi, "recent results")
    .replace(/recent results should appear shortly/gi, "Results should appear shortly")
    .replace(/(^|[.!?]\s+)([a-z])/g, (match) => match.toUpperCase());
}

export function formatSearchResultsAnnouncement(
  result: SearchResponse,
  options: {
    isLoading?: boolean;
    recovered?: boolean;
    addedCount?: number;
    retryCursor?: string | null;
  } = {},
) {
  if (options.isLoading) {
    return "Loading more search results…";
  }

  const resultCount = result.ads.length;
  const resultLabel = resultCount === 1 ? "result" : "results";
  const completion = result.nextCursor ? " More results are available." : " No more results.";
  const recovery = options.recovered ? " Search checks have recovered." : "";

  if (options.retryCursor) {
    const availabilityVerb = resultCount === 1 ? "remains" : "remain";
    return `${resultCount} search ${resultLabel} ${availabilityVerb} available. Fresh checks for more results are delayed. Retry when ready.`;
  }

  if (isDelayedDiscoveryStatus(result.discoveryStatus)) {
    if (resultCount === 0) {
      return "No results loaded. Fresh checks are delayed, so coverage may be incomplete.";
    }
    return `${resultCount} ${resultLabel} loaded. Fresh checks are delayed; showing recent results.${
      result.nextCursor ? " More results are available." : ""
    }`;
  }

  if (resultCount === 0) {
    return `No search results found. Search complete.${recovery}`;
  }

  if (options.addedCount && options.addedCount > 0) {
    const addedLabel = options.addedCount === 1 ? "result" : "results";
    return `${options.addedCount} more ${addedLabel} loaded. ${resultCount} total search ${resultLabel}.${completion}${recovery}`;
  }

  return `${resultCount} search ${resultLabel} loaded.${completion}${recovery}`;
}

export function resolveRecoveredSearchKey(input: {
  currentDiscoveryStatus: SearchResponse["discoveryStatus"];
  currentRecoveryKey: string | null;
  previousDiscoveryStatus: SearchResponse["discoveryStatus"];
  searchKey: string;
}) {
  if (isDelayedDiscoveryStatus(input.currentDiscoveryStatus)) {
    return null;
  }
  if (isDelayedDiscoveryStatus(input.previousDiscoveryStatus)) {
    return input.searchKey;
  }
  return input.currentRecoveryKey === input.searchKey ? input.currentRecoveryKey : null;
}

export function hasRecentSearchDelay(raw: string | null, now = Date.now()) {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { delayed?: unknown; observedAt?: unknown };
    return parsed.delayed === true &&
      typeof parsed.observedAt === "number" &&
      Number.isFinite(parsed.observedAt) &&
      parsed.observedAt <= now &&
      now - parsed.observedAt <= SEARCH_DELAY_RECOVERY_WINDOW_MS;
  } catch {
    return false;
  }
}

function formatEmptyResultHeadline(
  result: SearchResponse,
  context: {
    displayDomain?: string | null;
    isDomainSearch?: boolean;
    isBroaderScope?: boolean;
    relevanceApplied?: boolean;
  } = {},
) {
  if (result.discoveryStatus === "disabled") {
    return "Enter a competitor website";
  }

  if (/warming this query|already warming/i.test(result.discoverySummary ?? "")) {
    return "Checking this competitor";
  }

  if (isDelayedDiscoveryStatus(result.discoveryStatus)) {
    return "Search preview is temporarily unavailable";
  }

  if (
    context.relevanceApplied &&
    context.isDomainSearch &&
    context.displayDomain &&
    !context.isBroaderScope
  ) {
    return `No verified ads found for ${context.displayDomain}`;
  }

  return "No ads found for this competitor";
}

function isDelayedDiscoveryStatus(status: SearchResponse["discoveryStatus"]) {
  return status === "degraded" || status === "cache_only";
}

export function formatResultsPanelTitle(
  result: SearchResponse,
  context: {
    displayDomain?: string | null;
    isDomainSearch?: boolean;
    isBroaderScope?: boolean;
    relevanceApplied?: boolean;
  } = {},
) {
  if (result.ads.length > 0) {
    if (
      context.relevanceApplied &&
      context.isDomainSearch &&
      context.displayDomain &&
      !context.isBroaderScope
    ) {
      const verifiedNoun = result.ads.length === 1 ? "ad" : "ads";
      return `${result.ads.length} verified ${verifiedNoun} linked to ${context.displayDomain}`;
    }

    if (context.isBroaderScope && context.displayDomain) {
      const verifiedCount = Math.max(0, Math.floor(result.verifiedCount ?? 0));
      const relatedCount = Math.max(0, result.ads.length - verifiedCount);
      const relatedNoun = relatedCount === 1 ? "match" : "matches";
      const broaderNoun = result.ads.length === 1 ? "match" : "matches";
      return verifiedCount > 0
        ? `${verifiedCount} verified and ${relatedCount} related ${relatedNoun} for ${context.displayDomain}`
        : `${result.ads.length} broader ${broaderNoun} for ${context.displayDomain}`;
    }

    return formatAdsFoundLabel(result.ads.length);
  }

  if (/warming this query|already warming/i.test(result.discoverySummary ?? "")) {
    return "Search in progress";
  }

  if (
    context.relevanceApplied &&
    context.isDomainSearch &&
    context.displayDomain &&
    !context.isBroaderScope
  ) {
    return `No verified ads for ${context.displayDomain}`;
  }

  return formatAdsFoundLabel(0);
}

function canCreateAdvertiserWatchlist(query: ReturnType<typeof normalizeSavedQuery>) {
  return (
    query.mode === "advertiser" &&
    Boolean(query.filters.query) &&
    query.filters.platform === "all" &&
    query.filters.creativeType === "all" &&
    query.filters.status === "all" &&
    !query.filters.firstSeenFrom &&
    !query.filters.lastSeenFrom
  );
}

function withSelected(params: URLSearchParams, selected: string | null) {
  const next = new URLSearchParams(params);
  if (selected) {
    next.set("selected", selected);
  }
  return next;
}

export function withSearchScope(params: URLSearchParams, scope: "exact" | "broader") {
  const next = new URLSearchParams(params);
  if (scope === "broader") next.set("broader", "1");
  else next.delete("broader");
  return next;
}

function appendCursor(params: URLSearchParams, after: string, selected: string | null) {
  const next = withSelected(params, selected);
  next.set("after", after);
  return next;
}

function withCompetitorWebsite(params: URLSearchParams, website: string) {
  const next = new URLSearchParams(params);
  if (website.trim()) {
    next.set("website", website.trim());
  }
  return next;
}

function withTrackingContext(
  params: URLSearchParams,
  website: string,
  trackingRole: WatchlistTrackingRole,
) {
  const next = withCompetitorWebsite(params, website);
  next.set("trackingRole", trackingRole);
  return next;
}

export function HydrateFallback() {
  return <DashboardRouteLoading title="search" />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}
