import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
  useRevalidator,
  useRouteLoaderData,
} from "react-router";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { AdThumb } from "~/components/ad-thumb";
import { DashboardPage } from "~/components/dashboard-page";
import { DashboardShell } from "~/components/dashboard-shell";
import {
  PublicSearchError,
  PublicSearchLoading,
  PublicSearchRateLimitError,
} from "~/components/public-route-state";
import { SearchResultRow } from "~/components/search/result-row";
import { SearchAnswerPanel } from "~/components/search-answer-panel";
import { SubmitButton } from "~/components/submit-button";
import {
  DetailBlock,
  DetailFacts,
  DetailPane,
  DetailPaneHead,
} from "~/components/workspace/detail-pane";
import { FeedbackStrip } from "~/components/workspace/feedback-strip";
import { RuledList } from "~/components/workspace/ruled-list";
import { WorkingHeader } from "~/components/workspace/working-header";
import { formatAdLongevityLabel } from "~/lib/ad-display";
import { getOptionalCloudflareContext } from "~/lib/cloudflare-context";
import { classifyAdRecordAngle } from "~/lib/ad-display";
import { isAdLibraryBackedAd } from "~/lib/ad-source-kind";
import { formatAngleDetail } from "~/lib/angle-display";
import {
  applyWebsiteSearchFallback,
  buildSignupTrackingPath,
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
import {
  defaultCountryForVisitor,
  ALL_COUNTRIES_VALUE,
  SUPPORTED_COUNTRIES,
} from "~/lib/countries";
import { formatOfferDisplay } from "~/lib/analysis-display";
import { scrubBrokenUnicode } from "~/lib/text-safe";
import {
  PUBLIC_SEARCH_RATE_LIMIT_MESSAGE,
  PUBLIC_SEARCH_SELECTION_RATE_LIMIT_MESSAGE,
} from "~/lib/customer-route-error";
import {
  formatAdvertiserLabel,
  formatCaptureMethodLabel,
  formatLandingPageFormValue,
  formatLandingPageSignalValue,
} from "~/lib/landing-page-display";
import { buildSearchAnswer, type SearchStealSummary } from "~/lib/search-answer";
import {
  isTypingContext,
  nextSearchResultIndex,
  SEARCH_KEYBOARD_HINTS,
} from "~/lib/search-keyboard";
import {
  DEFAULT_SEARCH_RESULT_SORT,
  parseSearchResultSort,
  sortAdsForSearchDisplay,
  type SearchResultSort,
} from "~/lib/search-sort";
import {
  appendCursor,
  buildIdleSearchResult,
  buildSearchAccumulationKey,
  buildSearchResultHref,
  canCreateAdvertiserWatchlist,
  createSearchAccumulationState,
  formatAdActiveStatus,
  formatAdDetailBody,
  formatCreativeFormatLabel,
  formatDiscoverySummary,
  formatEmptyResultHeadline,
  formatHookLabel,
  formatOfferLabel,
  formatProofCaptureLabel,
  formatResultsPanelTitle,
  formatResultTierConfidence,
  formatSearchCommandTitle,
  formatSearchCaptureAgeLabel,
  formatSearchFreshnessLabel,
  formatSearchResultsAnnouncement,
  formatSearchSourceLabel,
  formatSearchTierProgressRow,
  formatResultTierTail,
  formatLandingPageCaptureGap,
  formatSelectedLandingFactValue,
  formatSelectedLandingHeadline,
  hasRecentSearchDelay,
  isDelayedDiscoveryStatus,
  mergeSearchAccumulationState,
  resolveRecoveredSearchKey,
  resolveResultTierCounts,
  type SearchAccumulationState,
  shouldShowApproximateFormatNotice,
  withSearchScope,
  withTrackingContext,
} from "~/lib/search-display";
import {
  canonicalLinks,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
} from "~/lib/seo";
import { normalizeWatchlistTrackingRole } from "~/lib/watchlist-role";
import type { RootLoaderData } from "~/root";
import type { SearchFilters, WatchlistTrackingRole } from "~/lib/types";

// Re-exported so existing test imports from "~/routes/search" keep working
// after the pure helpers moved to "~/lib/search-display".
export {
  buildSearchAccumulationKey,
  buildSearchResultHref,
  createSearchAccumulationState,
  formatAdActiveStatus,
  formatCreativeFormatLabel,
  formatDiscoverySummary,
  formatHookLabel,
  formatOfferLabel,
  formatResultsPanelTitle,
  formatSearchResultsAnnouncement,
  hasRecentSearchDelay,
  mergeSearchAccumulationState,
  resolveRecoveredSearchKey,
  shouldShowApproximateFormatNotice,
  withSearchScope,
};
export type { SearchAccumulationState };

// BET 2 (issue 951): poll every 2s (was 5s) so a partial cache entry written
// mid-capture paints the first card in seconds, and the final write swaps in
// the complete set with at most 2s of lag. The 60s budget is preserved by
// raising the poll cap from 12 to 30.
const SEARCH_WARMING_POLL_MS = 2_000;
export const SEARCH_WARMING_POLL_LIMIT = 30; // 60s cap
// Long-horizon escape hatch for the public submit hang: how long an in-flight
// /search GET may keep the idle pre-search page spinning before the client
// forces a fresh page load to the exact target URL. Exported so tests can pin
// the exact grace window.
export const SEARCH_NAVIGATION_SETTLE_GRACE_MS = 90_000;

const searchTitle = "Search competitor Meta ads free | Five to Nine";
const searchDescription =
  "Preview public competitor ad results before creating an account; sign in to save examples and track offer changes over time. Provider coverage and freshness vary.";
const SEARCH_DELAY_SESSION_KEY = "f9.search.recent-delay.v1";

export const links: LinksFunction = () => canonicalLinks("/search");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: searchTitle,
    description: searchDescription,
    pathname: "/search",
  });

// When the search loader throws a 429 (anonymous limiter), React Router only
// merges cookies from the thrown response's headers onto the final document
// response unless the boundary route forwards them. Copy Retry-After through
// here so the rate-limited document keeps the limiter's recovery signal. For
// every other request errorHeaders is undefined and nothing is added.
export const headers: HeadersFunction = ({ errorHeaders }) => {
  const documentHeaders: Record<string, string> = {};
  const retryAfter = errorHeaders?.get("retry-after");
  if (retryAfter) documentHeaders["Retry-After"] = retryAfter;
  return documentHeaders;
};

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getOptionalSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { listCollections } = await import("~/lib/data.server");
  const runtimeEnv = getEnv(context);
  const cloudflare = getOptionalCloudflareContext(context);
  const { resolveE2EProviderDeny, sanitizeE2EProviderEnv } =
    await import("~/lib/e2e-provider.server");
  const providerDeny = await resolveE2EProviderDeny(runtimeEnv, request);
  if (providerDeny.failClosed && !providerDeny.enabled) {
    throw new Response("The local release-proof environment is unavailable.", {
      status: 503,
    });
  }
  const requestEnv = providerDeny.enabled
    ? sanitizeE2EProviderEnv(runtimeEnv)
    : runtimeEnv;
  const e2eSearch = await (
    await import("~/lib/e2e-search.server")
  ).resolveE2ELocalSearchContext(requestEnv, request);
  const env = e2eSearch.env;
  const session = await getOptionalSession(env, request);
  const workspaceUserId = session
    ? (
        await (
          await import("~/lib/workspace.server")
        ).resolveWorkspace(env, session.user.id)
      ).workspaceUserId
    : null;
  const navFlags = session
    ? {
        showPresenceNav: await (
          await import("~/lib/presence-internal-access.server")
        ).presenceNavVisible(env, workspaceUserId!),
      }
    : { showPresenceNav: false };
  const url = new URL(request.url);
  // The visitor-geo country is a UI preselection, never a silently committed
  // filter. An anonymous visitor who never picked a country gets the global
  // search ("all countries"): committing cf-ipcountry into an anonymous
  // search scopes results to a market nobody chose and bakes that country
  // into the result links. Signed-in visitors keep the geo default so the
  // refine picker and onboarding can preselect their market.
  const visitorCountry = session
    ? defaultCountryForVisitor(
        cloudflare?.country ??
          request.headers.get("cf-ipcountry"),
      )
    : ALL_COUNTRIES_VALUE;
  const competitorWebsite = normalizeCompetitorWebsiteInput(
    url.searchParams.get("website") ?? "",
  );
  const parsedInput = parseSearchParams(url.searchParams, {
    country: visitorCountry,
  });
  const parsed = hasInvalidCompetitorWebsite(competitorWebsite)
    ? parsedInput
    : applyWebsiteSearchFallback(parsedInput, competitorWebsite);
  const trackingRole = normalizeWatchlistTrackingRole(
    url.searchParams.get("trackingRole"),
  );
  const searchScope =
    url.searchParams.get("broader") === "1" ? "broader" : "exact";
  const forceLive = canUseCanaryFreshLiveBypass(env, request, url);

  if (hasInvalidCompetitorWebsite(competitorWebsite)) {
    return {
      mode: parsed.mode,
      filters: parsed.filters,
      fingerprint: parsed.fingerprint,
      result: buildIdleSearchResult(),
      selectedAd: null,
      resultCaptureAgeLabel: null,
      stealSummary: null,
      selectionEnrichmentPending: false,
      landingPageCaptureFailure: null,
      collections: [],
      plan: null,
      session,
      competitorWebsite,
      trackingRole,
      inputError: competitorWebsite.error,
      searchScope: "exact" as const,
      displayDomain: null,
      relevanceApplied: false,
      watchedWatchlist: null,
      ...navFlags,
    };
  }

  if (
    !session &&
    request.method.toUpperCase() === "HEAD" &&
    parsed.filters.query
  ) {
    return {
      mode: parsed.mode,
      filters: parsed.filters,
      fingerprint: parsed.fingerprint,
      result: buildIdleSearchResult(),
      selectedAd: null,
      resultCaptureAgeLabel: null,
      stealSummary: null,
      selectionEnrichmentPending: false,
      landingPageCaptureFailure: null,
      collections: [],
      plan: null,
      session,
      competitorWebsite,
      trackingRole,
      inputError: null,
      searchScope: "exact" as const,
      displayDomain: null,
      relevanceApplied: false,
      watchedWatchlist: null,
      ...navFlags,
    };
  }

  // One parallel wave for the independent per-account lookups (customer Meta
  // token, collections, plan) instead of three serial awaits. Anonymous
  // visitors resolve constants here — no extra queries on that path.
  const [customerMetaAdLibraryToken, collections, plan] = await Promise.all([
    session && parsed.filters.query && !providerDeny.enabled
      ? import("~/lib/customer-meta.server").then(({ getCustomerMetaAdLibraryToken }) =>
          getCustomerMetaAdLibraryToken(env, workspaceUserId!),
        )
      : null,
    session ? listCollections(env, workspaceUserId!) : [],
    session
      ? import("~/lib/plan.server")
          .then(({ getUserPlan }) => getUserPlan(env, workspaceUserId!))
          .catch((): null => {
            // On a transient plan-lookup blip (D1 hiccup or isolated test env
            // without D1) the UI payload gets plan=null so nothing renders
            // from a guess — no free-plan upsell, no paid-only affordances.
            // Only the rate-limit call below substitutes "starter" so a
            // paying customer is not throttled to free limits. Real plan
            // gates (saves, watchlists) re-check server-side and fail closed.
            return null;
          })
      : (null as "free" | "scout" | "starter" | "agency" | null),
  ]);

  // Selecting an ad from already-rendered results reruns this loader with the
  // same query; when the discovery cache can serve that query, the click must
  // not consume the fresh-search rate limit. Fresh searches always charge.
  // Anonymous explicit selections run fetch-only landing capture and consume
  // public-search-selection; signed-in warm selections still use search-selection.
  const selectionServedFromCache =
    Boolean(url.searchParams.get("selected")) &&
    Boolean(parsed.filters.query) &&
    !forceLive
      ? await (
          await import("~/lib/search-execution.server")
        ).hasWarmSearchCacheEntry({
          env,
          competitorWebsite,
          parsed,
          scope: searchScope,
          cursor: url.searchParams.get("after"),
          customerMetaAdLibraryToken,
        })
      : false;

  if (
    !session &&
    parsed.filters.query &&
    !forceLive &&
    !selectionServedFromCache
  ) {
    const { enforcePublicSearchRateLimit } =
      await import("~/lib/rate-limit.server");
    const rateLimitResponse = await enforcePublicSearchRateLimit(
      request,
      env,
      cloudflare?.ctx,
    );
    if (rateLimitResponse) {
      const { emitFunnelSearchError } = await import("~/lib/funnel-measurement.server");
      emitFunnelSearchError(env, request, "rate_limited");
      // Anonymous throttling is a normal, recoverable product state, not an
      // internal failure: throw an explicit in-product 429 document whose
      // body names the limit and the recovery path, and keep the limiter's
      // Retry-After signal so the client and the document response both know
      // when the window clears. The route-level headers() export below
      // forwards that header onto the final document response.
      const retryAfterSeconds = rateLimitResponse.headers.get("retry-after");
      throw new Response(
        JSON.stringify({
          error: "rate_limited",
          message: PUBLIC_SEARCH_RATE_LIMIT_MESSAGE,
          ...(retryAfterSeconds ? { retryAfter: Number(retryAfterSeconds) } : {}),
        }),
        {
          status: 429,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            ...(retryAfterSeconds ? { "retry-after": retryAfterSeconds } : {}),
          },
        },
      );
    }
  }

  if (!session && selectionServedFromCache) {
    const { enforcePublicSearchSelectionRateLimit } =
      await import("~/lib/rate-limit.server");
    const selectionLimit = await enforcePublicSearchSelectionRateLimit(
      request,
      env,
      cloudflare?.ctx,
    );
    if (selectionLimit) {
      const retryAfterSeconds = selectionLimit.headers.get("retry-after");
      throw new Response(
        JSON.stringify({
          error: "rate_limited",
          message: PUBLIC_SEARCH_SELECTION_RATE_LIMIT_MESSAGE,
          ...(retryAfterSeconds ? { retryAfter: Number(retryAfterSeconds) } : {}),
        }),
        {
          status: 429,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            ...(retryAfterSeconds ? { "retry-after": retryAfterSeconds } : {}),
          },
        },
      );
    }
  }

  if (session && parsed.filters.query && !forceLive) {
    const {
      enforceAuthenticatedSearchRateLimit,
      enforceSearchSelectionRateLimit,
    } = await import("~/lib/rate-limit.server");
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
        cloudflare?.ctx,
      );
      if (selectionLimit) {
        throw selectionLimit;
      }
    } else if (!warmQueryForBudget) {
      const searchLimit = await enforceAuthenticatedSearchRateLimit(
        request,
        env,
        session.user.id,
        cloudflare?.ctx,
        // Fail OPEN for rate-limit sizing only: an unknown plan gets starter
        // limits so a paying customer is not throttled to free ones.
        plan ?? "starter",
      );
      if (searchLimit) {
        // Prefer an in-product labeled daily/burst limit over a bare JSON 429.
        return {
          mode: parsed.mode,
          filters: parsed.filters,
          fingerprint: parsed.fingerprint,
          result: buildIdleSearchResult(),
          selectedAd: null,
          resultCaptureAgeLabel: null,
          stealSummary: null,
          selectionEnrichmentPending: false,
          landingPageCaptureFailure: null,
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
          watchedWatchlist: null,
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
      resultCaptureAgeLabel: null,
      stealSummary: null,
      selectionEnrichmentPending: false,
      landingPageCaptureFailure: null,
      collections,
      plan,
      session,
      competitorWebsite,
      trackingRole,
      inputError: null,
      searchScope: "exact" as const,
      displayDomain: null,
      relevanceApplied: false,
      watchedWatchlist: null,
      ...navFlags,
    };
  }

  const { executeSearchWithRelevance } =
    await import("~/lib/search-execution.server");
  const { shouldApplySearchV2, shouldRunSearchV2Shadow } =
    await import("~/lib/search-rollout.server");
  const { prepareSearchResultSelection } =
    await import("~/lib/search-selection.server");

  // Cross-link (workflow-friction pass): if the signed-in user already
  // watches this competitor, the results page links straight to its dossier.
  // One indexed D1 list per searched query — never blocks the search itself.
  const watchedWatchlist = session
    ? await (async () => {
        try {
          const { listWatchlists } = await import("~/lib/data.server");
          const { findWatchedCompetitor } = await import("~/lib/watchlist-links");
          const watchlists = await listWatchlists(env, workspaceUserId!);
          return findWatchedCompetitor(watchlists, {
            host: competitorWebsite.host,
            query: parsed.filters.query,
          });
        } catch {
          return null;
        }
      })()
    : null;

  const useSearchV2 =
    Boolean(competitorWebsite.raw) &&
    (shouldApplySearchV2(env) || shouldRunSearchV2Shadow(env));
  const { emitFunnelSearchSubmit, emitFunnelSearchResult, emitFunnelSearchError, funnelErrorKindFromUnknown } =
    await import("~/lib/funnel-measurement.server");
  // Submit counts a fresh query only — never an ad-selection reload or a
  // pagination step, each of which reruns this loader for the same search.
  const isSelectionReload = url.searchParams.has("selected");
  const isPaginationStep = Boolean(url.searchParams.get("after"));
  if (!isSelectionReload && !isPaginationStep) {
    emitFunnelSearchSubmit(env, request);
  }

  let searchExecution;
  try {
    searchExecution = useSearchV2
      ? await executeSearchWithRelevance({
          env,
          competitorWebsite,
          parsed,
          scope: searchScope,
          cursor: url.searchParams.get("after"),
          forceLive,
          customerMetaAdLibraryToken,
          executionContext: cloudflare?.ctx,
          hydratePersisted: Boolean(session),
          // Optional attribution: only attach the plan tier when the caller
          // actually resolved one; anonymous searches omit it so the call
          // contract that existing callers assert stays unchanged.
          ...(plan ? { planTier: plan } : {}),
        })
      : await (async () => {
          const legacyQuery = normalizeSavedQuery(parsed.mode, parsed.filters);
          const legacyResult = await (
            await import("~/lib/ad-source.server")
          ).searchAdsViaSourceResolver(
            env,
            legacyQuery,
            url.searchParams.get("after"),
            {
              purpose: "public_search",
              forceLive,
              // Cold path: an uncached first query returns the warming state
              // immediately and the browser capture finishes via waitUntil.
              executionContext: cloudflare?.ctx ?? null,
              // Optional attribution: omit when no plan tier was resolved.
              ...(plan ? { planTier: plan } : {}),
              ...(customerMetaAdLibraryToken
                ? { customerMetaAdLibraryToken }
                : {}),
            },
          );
          // BET 2: a bare `q=` keyword search has no `website=`, so it used
          // to render with no per-row confidence marker. Attach a
          // `domainMatch` object to every keyword row so each one states its
          // tier (verified / likely / unmatched). A `website=` search that
          // fell through to v1 because rollout is off keeps its existing
          // unlabelled behaviour — extending v2 to that path is a rollout
          // decision, not this change.
          const isKeywordSearch =
            !competitorWebsite.raw && Boolean(parsed.filters.query);
          const tieredResult = isKeywordSearch
            ? await (
                await import("~/lib/search-execution.server")
              ).attachKeywordSearchDomainMatch(
                env,
                legacyResult,
                parsed.filters.query,
                searchScope,
              )
            : legacyResult;
          return {
            result: tieredResult,
            query: legacyQuery,
            searchScope,
            displayDomain: competitorWebsite.host,
            relevanceApplied: false,
          };
        })();
  } catch (error) {
    // Coarse request-scoped failure record only; the search failure itself is
    // rethrown unchanged so the existing error UX owns the response.
    emitFunnelSearchError(env, request, funnelErrorKindFromUnknown(error));
    throw error;
  }

  const waitUntil = cloudflare?.ctx?.waitUntil?.bind(cloudflare?.ctx);
  // Anonymous default /search (no ?selected=) still auto-opens the featured
  // ad in the detail pane. Skipping enrichment there left the core promise
  // ("we check the landing page") as a dead-end gap for the first ad a
  // visitor sees. Provider-deny E2E fixtures stay capture-free.
  const enrichSelected =
    !providerDeny.enabled && Boolean(parsed.filters.query);
  const {
    result: hydratedResult,
    selectedAd,
    selectionEnrichmentPending,
    landingPageCaptureFailure,
  } = await prepareSearchResultSelection(
    env,
    searchExecution.result,
    url.searchParams.get("selected"),
    {
      enrichSelected,
      hydratePersisted: Boolean(session),
      ...(session || !enrichSelected ? {} : { allowRenderedFallback: false }),
      ...(plan ? { planTier: plan } : {}),
      // Signed-in captures persist, so waitUntil + revalidation can paint
      // fast. Anonymous captures are request-scoped: awaiting them is the
      // only way the snapshot reaches the HTML.
      ...(typeof waitUntil === "function" && session ? { waitUntil } : {}),
    },
  );

  emitFunnelSearchResult(env, request, hydratedResult.ads.length);

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

  // Carry a VERIFIED advertiser page id into the save/track forms so a watchlist
  // created from this search persists page-scoped scans (view_all_page_id) —
  // subsequent scrapes return the brand's own ads instead of keyword junk. Only
  // ever set from a verified match on the result; never from the search input.
  const verifiedAdvertiserPageId =
    (searchExecution.result as { verifiedAdvertiserPageId?: string | null })
      .verifiedAdvertiserPageId ?? null;
  const filtersForForms = verifiedAdvertiserPageId
    ? { ...parsed.filters, pageId: verifiedAdvertiserPageId }
    : parsed.filters;

  return {
    mode: parsed.mode,
    filters: filtersForForms,
    fingerprint: parsed.fingerprint,
    result: hydratedResult,
    selectedAd,
    resultCaptureAgeLabel: formatSearchCaptureAgeLabel(
      hydratedResult.cacheFetchedAt,
      new Date(),
    ),
    stealSummary,
    selectionEnrichmentPending: Boolean(selectionEnrichmentPending),
    landingPageCaptureFailure,
    collections,
    plan,
    session,
    competitorWebsite,
    trackingRole,
    searchScope: searchExecution.searchScope,
    displayDomain: searchExecution.displayDomain,
    relevanceApplied: searchExecution.relevanceApplied,
    inputError: null,
    watchedWatchlist,
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
  const { addAdToCollection, createSavedQuery } =
    await import("~/lib/data.server");
  const env = getEnv(context);
  const cloudflare = getOptionalCloudflareContext(context);
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
  const trackingRole = normalizeWatchlistTrackingRole(
    formData.get("trackingRole"),
  );
  const normalizedQuery = applyWebsiteSearchFallback(
    normalizeSavedQuery(
      String(formData.get("mode") ?? "advertiser") === "keyword"
        ? "keyword"
        : "advertiser",
      {
        query: String(formData.get("query") ?? ""),
        country:
          String(formData.get("country") ?? "") ||
          defaultCountryForVisitor(
            cloudflare?.country ?? request.headers.get("cf-ipcountry"),
          ),
        platform: String(formData.get("platform") ?? "all"),
        creativeType: String(
          formData.get("creativeType") ?? "all",
        ) as SearchFilters["creativeType"],
        status: String(
          formData.get("status") ?? "all",
        ) as SearchFilters["status"],
        firstSeenFrom: String(formData.get("firstSeenFrom") ?? ""),
        lastSeenFrom: String(formData.get("lastSeenFrom") ?? ""),
        // Verified page id from the search results (normalizeSearchFilters drops
        // anything non-numeric, so a spoofed/blank value can never scope a scan).
        pageId: String(formData.get("pageId") ?? ""),
      },
    ),
    competitorWebsite,
  );

  if (
    (intent === "save-query" || intent === "create-watchlist") &&
    hasInvalidCompetitorWebsite(competitorWebsite)
  ) {
    return { ok: false, message: competitorWebsite.error };
  }

  if (
    (intent === "save-query" || intent === "create-watchlist") &&
    !normalizedQuery.filters.query
  ) {
    return {
      ok: false,
      message: "Enter a competitor website before saving or tracking it.",
    };
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
    const { requireVerifiedEmailForRetention, emailUnverifiedActionResult } =
      await import("~/lib/email-verification.server");
    const verification = await requireVerifiedEmailForRetention(
      env,
      workspaceUserId,
    );
    if (!verification.ok) {
      return emailUnverifiedActionResult();
    }

    const inferredName =
      (competitorWebsite.displayName ?? normalizedQuery.filters.query) ||
      "Competitor";
    const queryName =
      String(formData.get("name") ?? "").trim() || `${inferredName} watch`;
    const shouldUseAdvertiserMode =
      canCreateAdvertiserWatchlist(normalizedQuery);
    const limitGate = await requireWorkspacePlanLimit(
      env,
      workspaceUserId,
      "watchlists",
      {
        limitMessage: ({ limit }) =>
          limit <= 1
            ? "Free includes 1 watchlist and 1 Collection. Upgrade for scheduled scans and more competitors."
            : "You've reached your competitor tracking limit.",
        upgradePath: "/app/billing?source=search#plans",
      },
    );
    if (!limitGate.ok) {
      return limitGate.result;
    }
    const watchlistLimit = limitGate.planLimit;

    const { createWatchlistWithinLimit } = await import("~/lib/data.server");
    let watchlistResult: Awaited<
      ReturnType<typeof createWatchlistWithinLimit>
    > | null = null;
    if (shouldUseAdvertiserMode) {
      watchlistResult = await createWatchlistWithinLimit(
        env,
        workspaceUserId,
        {
          name: queryName,
          targetType: "advertiser",
          targetId:
            competitorWebsite.normalizedUrl ?? normalizedQuery.filters.query,
          targetFingerprint: watchlistFingerprint(
            normalizedQuery,
            competitorWebsite,
          ),
          targetLabel: competitorTrackingLabel(
            competitorWebsite,
            normalizedQuery.filters.query,
          ),
          targetCountry: normalizedQuery.filters.country,
          trackingRole,
        },
        watchlistLimit.limit,
      );
    } else {
      const savedQuery = await createSavedQuery(env, workspaceUserId, {
        name: `${queryName} source`,
        mode: normalizedQuery.mode,
        filters: normalizedQuery.filters,
      });

      if (!savedQuery) {
        return {
          ok: false,
          message:
            "We couldn't set up tracking for this competitor. Try again, or email support if it keeps failing.",
        };
      }

      watchlistResult = await createWatchlistWithinLimit(
        env,
        workspaceUserId,
        {
          name: queryName,
          targetType: "saved_query",
          targetId: savedQuery.id,
          targetFingerprint: watchlistFingerprint(
            normalizedQuery,
            competitorWebsite,
          ),
          targetLabel:
            competitorTrackingLabel(
              competitorWebsite,
              normalizedQuery.filters.query,
            ) || savedQuery.name,
          targetCountry: normalizedQuery.filters.country,
          trackingRole,
        },
        watchlistLimit.limit,
      );
    }

    if (watchlistResult.status === "over_cap") {
      return planLimitExceededActionResult({
        limit: watchlistResult.limit,
        current: watchlistResult.current,
        message:
          watchlistResult.limit <= 1
            ? "Free includes 1 watchlist and 1 Collection. Upgrade for scheduled scans and more competitors."
            : "You've reached your competitor tracking limit.",
        upgradePath: "/app/billing?source=search#plans",
      });
    }

    const watchlist = watchlistResult.watchlist;
    const { queueFirstWatchlistScan } = await import("~/lib/monitoring.server");
    try {
      await queueFirstWatchlistScan(env, cloudflare?.ctx, watchlist);
    } catch {
      return {
        ok: false,
        error: "first_scan_dispatch_delayed",
        message:
          "Competitor saved, but the activation scan is delayed. Try tracking it again to resume the same safe scan.",
      };
    }

    if (!watchlist) {
      return { ok: false, message: "We couldn't create this watchlist. Try again in a moment." };
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
      return {
        ok: false,
        message: "Choose a collection and ad before saving.",
      };
    }

    // Server-side plan gate. Fail CLOSED for a free plan with no Collection
    // yet (the save targets an existing Collection; a missing/foreign id
    // would 500 inside addAdToCollection). Free includes exactly 1
    // Collection, so saving into it is allowed; the UI guides the
    // create-first step.
    let savePlan: "free" | "scout" | "starter" | "agency";
    try {
      const { getUserPlan } = await import("~/lib/plan.server");
      savePlan = await getUserPlan(env, workspaceUserId);
    } catch {
      return {
        ok: false,
        message:
          "We couldn't confirm your plan just now. Nothing was saved — try again in a moment.",
      };
    }
    if (savePlan === "free") {
      const { checkPlanLimit } = await import("~/lib/plan.server");
      const collectionSlots = await checkPlanLimit(env, workspaceUserId, "collections");
      if (collectionSlots.current < 1) {
        return {
          ok: false,
          error: "plan_limit_exceeded" as const,
          message: "Free includes 1 Collection — create it in the Library, then save this ad.",
          upgradePath: "/app/collections",
        };
      }
    }

    const { listAdsByIds } = await import("~/lib/data.server");
    const ad = (await listAdsByIds(env, [adId]))[0] ?? null;
    if (!ad) {
      return {
        ok: false,
        message:
          "That ad is no longer available to save. Select it again and retry.",
      };
    }
    if (!isAdLibraryBackedAd(ad)) {
      return {
        ok: false,
        message:
          "That result is not public Meta Ad Library evidence. Select a live ad result and retry.",
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

    return {
      ok: true,
      message: `Saved ${ad.advertiser?.trim() || "the ad"} to your collection.`,
    };
  }

  return {
    ok: false,
    message: "We couldn't complete that action. Refresh the page and try again.",
  };
}

export default function SearchRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const selectedProofRef = useRef<HTMLElement>(null);
  const previousDiscoveryStatusRef = useRef(data.result.discoveryStatus);
  const [recoveredSearchKey, setRecoveredSearchKey] = useState<string | null>(
    null,
  );
  // When the SPA never commits a submitted /search target (server settled but
  // the router keeps navigation.state=loading on the idle page), this holds the
  // in-flight target search string so the recovery block can reload it exactly.
  const [searchNavigationRecovery, setSearchNavigationRecovery] = useState<
    string | null
  >(null);
  const locationSearchParams = new URLSearchParams(location.search);
  const [resultSort, setResultSort] = useState<SearchResultSort>(
    () =>
      parseSearchResultSort(locationSearchParams.get("sort")) ||
      DEFAULT_SEARCH_RESULT_SORT,
  );
  const [warmingPollCount, setWarmingPollCount] = useState(0);
  const [
    selectionEnrichmentRevalidatedFor,
    setSelectionEnrichmentRevalidatedFor,
  ] = useState<string | null>(null);
  const requestedCursor = locationSearchParams.get("after");
  const selectedFromUrl = locationSearchParams.get("selected");
  const hasSelectedFromUrl = locationSearchParams.has("selected");
  const searchKey = buildSearchAccumulationKey(data);
  const selectionEnrichmentKey = selectedFromUrl
    ? `${searchKey}::${selectedFromUrl}`
    : data.selectedAd?.metaAdId
      ? `${searchKey}::${data.selectedAd.metaAdId}`
      : null;
  const [accumulated, setAccumulated] = useState<SearchAccumulationState>(() =>
    createSearchAccumulationState(
      searchKey,
      data.result,
      data.selectedAd,
      requestedCursor,
    ),
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
  const visibleAccumulated =
    accumulated.searchKey === searchKey
      ? accumulated
      : createSearchAccumulationState(
          searchKey,
          data.result,
          data.selectedAd,
          requestedCursor,
        );
  const visibleResult = visibleAccumulated.result;
  const visibleAds = useMemo(
    () => sortAdsForSearchDisplay(visibleResult.ads, resultSort),
    [visibleResult.ads, resultSort],
  );
  const selectedAd = hasSelectedFromUrl
    ? (data.selectedAd ??
      visibleAds.find((ad) => ad.metaAdId === selectedFromUrl) ??
      null)
    : (data.selectedAd ?? visibleAccumulated.selectedAd);

  useEffect(() => {
    setAccumulated((previous) => {
      const sameSearch = previous.searchKey === searchKey;
      const shouldMerge =
        sameSearch && (Boolean(requestedCursor) || hasSelectedFromUrl);
      if (!shouldMerge) {
        return createSearchAccumulationState(
          searchKey,
          data.result,
          data.selectedAd,
          requestedCursor,
        );
      }

      return mergeSearchAccumulationState(previous, data.result, {
        requestedCursor,
        selectedAd: data.selectedAd,
        selectionNavigation: hasSelectedFromUrl,
      });
    });
  }, [
    data.result,
    data.selectedAd,
    hasSelectedFromUrl,
    requestedCursor,
    searchKey,
    selectedFromUrl,
  ]);

  const rootData = useRouteLoaderData("root") as RootLoaderData;
  const creativeTextField = selectedAd?.analysisFields.find(
    (field) => field.fieldKey === "ocr_text",
  );
  const selectedAdAngle = selectedAd ? classifyAdRecordAngle(selectedAd) : null;
  const competitorWebsite = data.competitorWebsite ?? emptyCompetitorWebsite();
  // Idle `/search` with no query keeps the generic "Find competitor ads"
  // title. A valid `?website=` (e.g. `/ads/nike.com` live search) now names
  // the brand in the H1 via `formatSearchCommandTitle` + `displayName`, so a
  // first-time visitor sees whose ads they are looking at instead of an
  // idle-looking page. A invalid `?website=` (the incomplete-website form
  // error) keeps the generic title — the validation message already names
  // the miss.
  const commandTitle = competitorWebsite.displayName
    ? formatSearchCommandTitle(competitorWebsite.displayName, data.filters.country)
    : formatSearchCommandTitle(data.filters.query, data.filters.country);
  const websiteInputValue = competitorWebsite.raw || data.filters.query;
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
  // Route every new signup to the persistent setup card. Carry the website
  // (when present) and selected non-default country so the first action keeps
  // the visitor's search context. On a keyword `?q=`/`?query=` lookup with no
  // explicit `?website=`, derive the resolved brand from the top result's
  // landing page so the new account's first watch is the brand the visitor
  // just searched for — matching the `?website=` and `/ads/<domain>` paths.
  // rather than re-deriving it from geo. Omit "all", which is onboarding's
  // default and adds no user context.
  const signupTrackingPath = buildSignupTrackingPath({
    competitorWebsiteRaw: competitorWebsite.raw,
    ads: visibleAds,
    country: data.filters.country,
  });
  const inferredWatchlistName =
    (competitorWebsite.displayName ?? data.filters.query) || "Competitor";
  // Candidate-3 root-cause fix for the public submit hang: the See ads button
  // stays pending only while a GET navigation to /search targets a URL that is
  // NOT the committed location.search. Once the server commits results or an
  // error for the submitted URL — even if useNavigation still reports loading
  // — the target matches the committed location and the button re-enables
  // instead of spinning forever. The long-horizon recovery overrides it so the
  // button is never stuck disabled behind a navigation that cannot settle.
  // COLD-PATH (0509 lane 1): a settled request is not a finished search. The
  // first anonymous query for an uncached advertiser returns the typed warming
  // state immediately while the browser capture keeps running in the
  // background, so the submit keeps saying "Searching…" until the committed
  // page actually renders results or an error. It releases with the same 60s
  // budget as the warming poll, so a background capture that never lands
  // cannot leave the button disabled forever.
  const commandNavigationTarget =
    navigation.state === "loading" &&
    navigation.location?.pathname === "/search"
      ? (navigation.location.search ?? "")
      : null;
  // A committed validation error describes the PREVIOUS submission, not the
  // input being searched right now. While a re-submit GET navigation to a new
  // /search target is in flight, stop asserting the old error as an alert:
  // the honest state is "Searching…", and the fresh loader result (error or
  // results) takes over once it commits.
  const searchCommandInFlight =
    commandNavigationTarget !== null &&
    commandNavigationTarget !== location.search &&
    searchNavigationRecovery === null;
  const liveInputError = searchCommandInFlight ? null : data.inputError;
  const canTrackCurrentCompetitor =
    Boolean(data.filters.query || competitorWebsite.normalizedUrl) &&
    !liveInputError;
  const discoverySummary = formatDiscoverySummary(visibleResult);
  const hasSearchQuery = Boolean(data.filters.query || competitorWebsite.raw);
  const isSearchWarming = visibleResult.discoveryProgress === "warming";
  // BET 2 progressive first card (issue 1471): the synchronous tier the first
  // payload already has. Verified/likely/unmatched counts drive the
  // tier-progress row — "N verified · M checking…" — instead of a spinner-only
  // body on a cold search, so the first visible result content always renders
  // inside the <5s budget while the cold verify pass keeps running in the
  // background.
  const tierCounts = resolveResultTierCounts(visibleResult);
  // BET 2 three-tier tail (issue 1482): the honest sentence under the results
  // that reflects the current verified/likely/unmatched split. Re-computed
  // every render, so it updates in place as the warming poll appends rows.
  const tierTail = formatResultTierTail(visibleResult);
  // When the check outlives the 5s x 12 = 60s warming poll budget, the
  // promised auto-refresh stops silently: the page must say so and hand the
  // visitor a working retry instead of leaving "we'll refresh automatically"
  // up forever next to a still-warming server state.
  const warmingPollExhausted =
    isSearchWarming && warmingPollCount >= SEARCH_WARMING_POLL_LIMIT;
  // BET 2 (issue 951): the command stays pending while the search is warming,
  // EVEN when partial results have already painted (visibleAds.length > 0).
  // The first cards landed but the scroll-and-collect passes are still
  // running, so the submit button keeps saying "Searching…" instead of
  // re-enabling and implying the search is finished. The poll-budget cap
  // still releases it once the 60s budget exhausts.
  const commandNavigationPending =
    searchCommandInFlight ||
    (isSearchWarming &&
      hasSearchQuery &&
      !liveInputError &&
      warmingPollCount < SEARCH_WARMING_POLL_LIMIT &&
      searchNavigationRecovery === null);
  const displayDomain =
    data.displayDomain ?? competitorWebsite.host ?? competitorWebsite.raw;
  const isDomainSearch = Boolean(
    displayDomain && competitorWebsite.normalizedUrl,
  );
  const isBroaderScope = data.searchScope === "broader";
  const formatFilterApproximate =
    (data.filters.creativeType === "video" ||
      data.filters.creativeType === "carousel") &&
    (visibleResult.provider === "meta_library_browser" ||
      visibleResult.source === "meta_library_browser");
  const competitorWatchLabel = displayDomain || "this competitor";
  const signupCtaBody = `Create a free account and we'll keep watching ${competitorWatchLabel} — first scan runs immediately, and you'll get an email when their ads, offer, or landing page changes.`;
  const retrySearchPath = `${location.pathname}${location.search}${location.hash}`;
  const scopedSearchParams = withSearchScope(
    currentSearchParams,
    isBroaderScope ? "broader" : "exact",
  );
  // Shared card href for the result list and keyboard Enter — preserves the
  // per-ad source cursor semantics of the reconciled accumulation state.
  const resultCardHref = (metaAdId: string) =>
    buildSearchResultHref(
      scopedSearchParams,
      metaAdId,
      visibleAccumulated.adCursorById.get(metaAdId) ?? null,
    );

  // Keyboard basics (workflow-friction pass): j/k or arrows highlight, Enter
  // opens, s quick-saves, ? toggles the hints popover. Listeners skip typing
  // contexts and interactive targets, and clean up on unmount.
  const [keyFocusIndex, setKeyFocusIndex] = useState<number | null>(null);
  const [showKeyboardHints, setShowKeyboardHints] = useState(false);
  const keyFocusedAdId =
    keyFocusIndex !== null ? (visibleAds[keyFocusIndex]?.metaAdId ?? null) : null;
  const keyboardStateRef = useRef({
    keyFocusIndex,
    keyFocusedAdId,
    resultCardHref,
    visibleAds,
  });
  keyboardStateRef.current = {
    keyFocusIndex,
    keyFocusedAdId,
    resultCardHref,
    visibleAds,
  };
  useEffect(() => {
    setKeyFocusIndex(null);
  }, [searchKey, resultSort]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isTypingContext(event.target)
      ) {
        return;
      }
      const current = keyboardStateRef.current;
      if (event.key === "?") {
        event.preventDefault();
        setShowKeyboardHints((open) => !open);
        return;
      }
      const nextIndex = nextSearchResultIndex(
        event.key,
        current.keyFocusIndex,
        current.visibleAds.length,
      );
      if (nextIndex !== null) {
        event.preventDefault();
        setKeyFocusIndex(nextIndex);
        return;
      }
      if (!current.keyFocusedAdId) {
        return;
      }
      // Enter/s on a focused link or button keeps its native behavior.
      if (
        event.target instanceof HTMLAnchorElement ||
        event.target instanceof HTMLButtonElement
      ) {
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        navigate(current.resultCardHref(current.keyFocusedAdId));
        return;
      }
      if (event.key === "s") {
        event.preventDefault();
        const escaped =
          typeof CSS !== "undefined" && typeof CSS.escape === "function"
            ? CSS.escape(current.keyFocusedAdId)
            : current.keyFocusedAdId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        document
          .querySelector<HTMLButtonElement>(`[data-quick-save-ad="${escaped}"]`)
          ?.click();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);
  useEffect(() => {
    if (keyFocusIndex === null) {
      return;
    }
    document
      .querySelector(".f9-wk-row.is-key-focus")
      ?.scrollIntoView({ block: "nearest" });
  }, [keyFocusIndex]);

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
      // Never revalidate while a route navigation is in flight: that
      // revalidation aborts/restarts the in-flight GET search. Resume only
      // once both the revalidator and the navigation are idle.
      if (
        revalidator.state === "idle" &&
        navigation.state === "idle"
      ) {
        revalidator.revalidate();
      }
    }, SEARCH_WARMING_POLL_MS);
    return () => clearTimeout(timer);
  }, [isSearchWarming, warmingPollCount, revalidator, navigation.state]);

  useEffect(() => {
    // Reset warming poll budget when the query identity changes.
    setWarmingPollCount(0);
  }, [searchKey]);

  // A retry ("Retry this search") or a same-query re-submit navigates to the
  // same URL, so the searchKey does not change and the exhausted poll budget
  // would otherwise carry into the fresh check — leaving it without any
  // auto-refresh while its capture runs. Once a navigation commits, start a
  // fresh budget so the honest end state's retry actually re-arms the poll.
  // Revalidations never touch navigation.state, so polling itself never
  // resets here.
  const navigationInFlightRef = useRef(false);
  useEffect(() => {
    if (navigation.state === "loading") {
      navigationInFlightRef.current = true;
    } else if (navigation.state === "idle" && navigationInFlightRef.current) {
      navigationInFlightRef.current = false;
      setWarmingPollCount(0);
    }
  }, [navigation.state]);

  // Long-horizon recovery: while a /search GET is genuinely loading and the
  // committed page is still the untouched idle pre-search form, arm a 90s
  // grace timer. If the target never commits (server settled but the SPA
  // never updates the URL), surface the recovery block with a fresh page load
  // to the exact in-flight target. Clearing happens on the same effect run:
  // the moment navigation settles, the target changes, or the committed page
  // leaves the idle state, the timer is torn down and recovery is reset.
  useEffect(() => {
    const target = navigation.location?.search ?? "";
    const isInFlightIdleSearch =
      navigation.state === "loading" &&
      navigation.location?.pathname === "/search" &&
      target !== "" &&
      !hasSearchQuery;
    setSearchNavigationRecovery(null);
    if (!isInFlightIdleSearch) {
      return;
    }
    const timer = setTimeout(() => {
      setSearchNavigationRecovery(target);
    }, SEARCH_NAVIGATION_SETTLE_GRACE_MS);
    return () => clearTimeout(timer);
  }, [
    navigation.state,
    navigation.location?.pathname,
    navigation.location?.search,
    hasSearchQuery,
  ]);

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
      // Same rule as warming: a revalidation here would abort/restart an
      // in-flight GET navigation, so wait until navigation is idle too.
      // Burn the one-shot key only when the revalidation actually fires —
      // marking it first spends the single attempt on a run that was skipped,
      // so enrichment that finished server-side would never be fetched and the
      // UI would fall back to "Not detected…" with the data sitting ready.
      if (
        revalidator.state === "idle" &&
        navigation.state === "idle"
      ) {
        setSelectionEnrichmentRevalidatedFor(selectionEnrichmentKey);
        revalidator.revalidate();
      }
    }, 4_000);
    return () => clearTimeout(timer);
  }, [
    data.selectionEnrichmentPending,
    selectionEnrichmentKey,
    selectionEnrichmentRevalidatedFor,
    revalidator,
    navigation.state,
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
    recovered:
      recoveredFromDiscoveryFailure || recoveredSearchKey === searchKey,
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
  const searchAnswer =
    hasSearchQuery && !data.inputError && !isSearchWarming
      ? buildSearchAnswer({
          result: visibleResult,
          displayDomain,
          isDomainSearch: isDomainSearch && data.relevanceApplied,
          isBroaderScope,
          query: data.filters.query,
          country: data.filters.country,
        })
      : null;

  // BL-031: the refine panel is a disclosure that stays SHUT until the visitor
  // actually has filters on, so the pre-search screen is one field and one
  // button instead of a six-control form page. The count is written into the
  // summary so a narrowed search never looks like a broad one.
  const activeRefineFilters = [
    data.filters.country && data.filters.country !== ALL_COUNTRIES_VALUE
      ? "country"
      : null,
    data.filters.platform && data.filters.platform !== "all" ? "platform" : null,
    data.filters.creativeType && data.filters.creativeType !== "all"
      ? "creative"
      : null,
    data.filters.status && data.filters.status !== "all" ? "status" : null,
    data.filters.firstSeenFrom ? "first seen" : null,
    data.filters.lastSeenFrom ? "last active" : null,
  ].filter((entry): entry is string => entry !== null);
  // BL-031 round 2 — the instrument's own state, and the hinge for everything
  // that sits above the first record. "Used" means a search actually ran and
  // was accepted; an invalid domain has not used the instrument, it has been
  // refused by it.
  const instrumentUsed = hasSearchQuery && !liveInputError;
  const hasResults = visibleAds.length > 0;
  // BL-031 round 3 — the refine disclosure counts only filters on a search
  // that actually ran. The loader geo-defaults `country` to the visitor's
  // country, so a pristine /search must not open the panel or print "1 on"
  // for a filter nobody turned on — the pre-search screen stays one field
  // and one button. A narrowed search that ran still opens with its count.
  const refineDisclosureActive =
    instrumentUsed && activeRefineFilters.length > 0;
  // One context line under the title (the v4 header contract): what this page
  // searches and what happens to a result. Provenance belongs to the capture,
  // so source and freshness are told once, in the evidence pane.
  //
  // ROUND 2: the context line qualifies the TITLE — it explains what the
  // instrument does before you have used it. Once a search has run, the line
  // that qualifies this page is the ANSWER, and the answer is the results
  // section head one block below. Printing both is the "three tellings of one
  // fact" the concept notes killed, and it costs 27px above the first record.
  // The anonymous "No account needed." claim in particular is asserted before
  // the search and PROVEN by it — repeating it afterwards is weaker, not
  // stronger.
  const headerContext = instrumentUsed
    ? null
    : rootData.session
      ? "Public Meta Ad Library search. Save an ad to a collection, or start watching the competitor."
      : "Public Meta Ad Library search. No account needed.";
  // The hint is instruction for an unused instrument. It stays for the resting
  // state and it becomes the `role="alert"` on a refused one; a field that
  // already holds the domain you searched does not need to be told what to
  // paste into it.
  const commandHint =
    liveInputError ?? (instrumentUsed ? null : "Paste one competitor website.");
  // ONE heading per state, and it is the sentence that state actually wants
  // to say. The search answer's title is the strongest when there is one (it
  // is what the old page rendered as the answer panel's h3, directly under a
  // near-identical results title); otherwise the empty / delayed / disabled
  // states own it; otherwise the results count does. Warming keeps the
  // results title ("Search in progress") and states the live check as a
  // sentence in its own polite live region.
  const emptyHeadline =
    visibleAds.length === 0 && !isSearchWarming
      ? formatEmptyResultHeadline(visibleResult, {
          displayDomain,
          isDomainSearch,
          isBroaderScope,
          relevanceApplied: data.relevanceApplied,
          country: data.filters.country,
        })
      : null;
  const sectionHeadline =
    searchAnswer?.title ??
    emptyHeadline ??
    formatResultsPanelTitle(visibleResult, {
      displayDomain,
      isDomainSearch,
      isBroaderScope,
      relevanceApplied: data.relevanceApplied,
      country: data.filters.country,
    });
  const selectedLongevity = selectedAd ? formatAdLongevityLabel(selectedAd) : null;
  const selectedRunning =
    selectedAd?.activeStatusObserved !== false && Boolean(selectedAd?.active);

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
      accountDetail={
        rootData.session ? "Saved searches and watches" : "Find competitor ads"
      }
      accountLabel={rootData.session ? "Workspace" : "Search"}
      accountTitle="Five to Nine"
      isPublic={!rootData.session}
      pageClassName="f9-find-page"
      showPresenceNav={data.showPresenceNav}
      userEmail={rootData.session?.user.email}
      userName={rootData.session?.user.name}
    >
      {/* Truthful WebPage JSON-LD mirroring the meta head: same title,
          same description, same canonical URL. It states only what the idle
          page itself says — no result counts, prices, or rankings, which the
          page has not produced yet. */}
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: searchTitle,
            description: searchDescription,
            pathname: "/search",
          }),
        )}
      />
      <DashboardPage className="f9-wk-page">
        <WorkingHeader
          context={headerContext}
          title={commandTitle}
          titleId="search-command-title"
        />

        {/* The command band. DNA §2: the input is a frame, its label sits
            above it as a micro-label, and the page's ONE filled button is the
            submit that runs the search. Everything else on this page is a
            text action. */}
        <section
          aria-labelledby="search-command-title"
          className="f9-wk-command"
        >
          <Form className="f9-wk-command-form" method="get">
            <input name="mode" type="hidden" value="advertiser" />
            <input name="trackingRole" type="hidden" value="competitor" />
            <div className="f9-wk-command-row">
            <label className="f9-wk-field is-lead">
              <span className="f9-wk-lab">Competitor website</span>
              <input
                aria-invalid={Boolean(liveInputError)}
                aria-describedby={commandHint ? "search-command-hint" : undefined}
                autoComplete="url"
                className="f9-wk-in"
                defaultValue={websiteInputValue}
                inputMode="url"
                name="website"
                placeholder="https://competitor.com"
                spellCheck={false}
                type="text"
              />
            </label>
            <SubmitButton
              className="f9-wk-btn"
              getAction="/search"
              pending={commandNavigationPending}
              pendingLabel="Searching…"
            >
              See ads
            </SubmitButton>
            </div>

            {/* DNA §2: validation speaks in product voice under the field it
                is about — one telling, not a banner plus a hint saying the
                same thing 200px apart. */}
            {commandHint ? (
              <p
                aria-live={liveInputError ? "assertive" : undefined}
                className={`f9-wk-hint${liveInputError ? " is-bad" : ""}`}
                id="search-command-hint"
                role={liveInputError ? "alert" : undefined}
              >
                {commandHint}
              </p>
            ) : null}

            <details
              className="f9-wk-refine"
              open={refineDisclosureActive}
            >
            <summary>
              Refine search
              {refineDisclosureActive ? (
                <span className="f9-wk-refine-n">
                  {activeRefineFilters.length} on
                </span>
              ) : null}
            </summary>
            <div
              className="f9-search-refine"
              role="group"
              aria-label="Search filters"
            >
              <label className="f9-wk-field">
                <span className="f9-wk-lab">Country</span>
                <select
                  className="f9-wk-sel"
                  defaultValue={data.filters.country}
                  name="country"
                >
                  <option value={ALL_COUNTRIES_VALUE}>All countries</option>
                  {SUPPORTED_COUNTRIES.map((country) => (
                    <option key={country.code} value={country.name}>
                      {country.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="f9-wk-field">
                <span className="f9-wk-lab">Platform</span>
                <select
                  className="f9-wk-sel"
                  defaultValue={data.filters.platform}
                  name="platform"
                >
                  <option value="all">All platforms</option>
                  <option value="Facebook">Facebook</option>
                  <option value="Instagram">Instagram</option>
                  <option value="Audience Network">Audience Network</option>
                  <option value="Messenger">Messenger</option>
                </select>
              </label>
              <label className="f9-wk-field">
                <span className="f9-wk-lab">Creative</span>
                <select
                  className="f9-wk-sel"
                  defaultValue={data.filters.creativeType}
                  name="creativeType"
                >
                  <option value="all">All creatives</option>
                  <option value="image">Image</option>
                  <option value="video">Video</option>
                  <option value="carousel">Carousel</option>
                </select>
              </label>
              <label className="f9-wk-field">
                <span className="f9-wk-lab">Status</span>
                <select
                  className="f9-wk-sel"
                  defaultValue={data.filters.status}
                  name="status"
                >
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
              <label className="f9-wk-field">
                <span className="f9-wk-lab">First seen after</span>
                <input
                  className="f9-wk-in"
                  defaultValue={data.filters.firstSeenFrom}
                  name="firstSeenFrom"
                  type="date"
                />
              </label>
              <label className="f9-wk-field">
                <span className="f9-wk-lab">Last active after</span>
                <input
                  className="f9-wk-in"
                  defaultValue={data.filters.lastSeenFrom}
                  name="lastSeenFrom"
                  type="date"
                />
              </label>
            </div>
            </details>
          </Form>

          {/* Long-horizon recovery for the submit hang: the server settled but
              the SPA never committed the target URL, so offer a fresh page
              load to the exact in-flight /search target instead of an eternal
              "Searching…". reloadDocument forces the full document load. */}
          {searchNavigationRecovery !== null ? (
            <div
              aria-live="assertive"
              className="f9-wk-note f9-search-settle-recovery"
              role="alert"
            >
              <p className="f9-wk-lede">
                This search never finished loading
              </p>
              <p className="f9-wk-note">
                It has been waiting for about a minute and a half. Reload the
                search to open it in a fresh page load.
              </p>
              <div className="f9-wk-acts">
                <Link
                  className="f9-wk-lnk"
                  reloadDocument
                  to={`/search${searchNavigationRecovery}`}
                >
                  Reload the search{" "}
                  <span aria-hidden="true" className="f9-wk-chev">
                    &rsaquo;
                  </span>
                </Link>
              </div>
            </div>
          ) : null}

        </section>

        {actionData?.message ? (
          <FeedbackStrip
            label={actionData.ok ? "Done" : "Not done"}
            tone={actionData.ok ? "ok" : "bad"}
          >
            {actionData.message}
            {"error" in actionData &&
            actionData.error === "plan_limit_exceeded" ? (
              <>
                {" "}
                <Link to="/app/billing?source=search#plans">View plans</Link> to
                raise the limit.
              </>
            ) : null}
          </FeedbackStrip>
        ) : null}

        {hasSearchQuery ? (
          <>
          <div
            className={`f9-wk-split is-wide${selectedAd ? "" : " is-single"}`}
          >
            <div className="f9-wk-split-list">
              <section
                /* No `aria-labelledby` here: when the heading reads "Enter a
                   competitor website" the region borrows the same accessible
                   name as the search field, and `getByLabel` — the way an
                   assistive reader addresses a control — resolves to both. A
                   section with a heading inside needs no second name. */
                className="f9-results-panel"
                data-f9-result-cache-status={
                  visibleResult.cacheStatus ?? undefined
                }
                data-f9-result-empty-reason={
                  visibleResult.discoveryEmptyReason ?? undefined
                }
                data-f9-result-source={
                  visibleResult.provider ?? visibleResult.source
                }
              >
                <div className="f9-wk-sec-head">
                  <div className="f9-wk-sec-headings">
                    {/* ONE heading per state. The empty and delayed states
                        used to print a near-identical second headline
                        directly under this one ("No verified ads for X" over
                        "No verified ads found for X"); the state's own
                        sentence is now the section title. */}
                    <h2 className="f9-wk-sec-title">
                      {sectionHeadline}
                    </h2>
                    {/* Snapshot age: a cache-served result names how old the
                        capture is, so a stale per-country snapshot is
                        self-evidently stale instead of looking current. The
                        label is computed once in the loader (hydration-safe). */}
                    {data.resultCaptureAgeLabel ? (
                      <p className="f9-wk-sec-sub f9-wk-sec-capture-age">
                        {data.resultCaptureAgeLabel}
                      </p>
                    ) : null}
                    {/* One sub-line, and the search answer's own sentence
                        wins it when there is one — the panel below then
                        carries only the facts it uniquely knows. */}
                    {searchAnswer ? (
                      <p className="f9-wk-sec-sub">{searchAnswer.summary}</p>
                    ) : isDomainSearch &&
                      data.relevanceApplied &&
                      !isBroaderScope ? (
                      <p className="f9-wk-sec-sub">{`Verified ads linked to ${displayDomain}`}</p>
                    ) : isDomainSearch && isBroaderScope ? (
                      <p className="f9-wk-sec-sub">{`Broader matches related to ${displayDomain}`}</p>
                    ) : null}
                  </div>
                  <div className="f9-wk-sec-acts">
                    {visibleAds.length > 1 ? (
                      <label className="f9-wk-field is-inline">
                        <span className="f9-sr-only">Sort results</span>
                        <select
                          aria-label="Sort results"
                          className="f9-wk-sel"
                          value={resultSort}
                          onChange={(event) =>
                            setResultSort(
                              parseSearchResultSort(event.target.value),
                            )
                          }
                        >
                          <option value="active_first">Active first</option>
                          <option value="longest_running">
                            Longest running
                          </option>
                          <option value="newest">Newest</option>
                        </select>
                      </label>
                    ) : null}
                    {visibleAds.length > 0 ? (
                      <div className="f9-wk-hints">
                        <button
                          aria-expanded={showKeyboardHints}
                          aria-label="Keyboard shortcuts"
                          className="f9-wk-lnk"
                          onClick={() => setShowKeyboardHints((open) => !open)}
                          type="button"
                        >
                          Shortcuts
                        </button>
                        {showKeyboardHints ? (
                          <dl className="f9-wk-hints-body">
                            {SEARCH_KEYBOARD_HINTS.map((hint) => (
                              <div key={hint.keys}>
                                <dt>{hint.keys}</dt>
                                <dd>{hint.action}</dd>
                              </div>
                            ))}
                          </dl>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div aria-live="polite" className="f9-sr-only" role="status">
                  {resultsAnnouncement}
                </div>

                {data.watchedWatchlist ? (
                  <p className="f9-wk-note">
                    You already watch this competitor.{" "}
                    <Link
                      className="f9-wk-lnk f9-wk-lnk--quiet"
                      to={`/app/watchlists?watchlist=${data.watchedWatchlist.id}`}
                    >
                      Open its dossier
                    </Link>
                  </p>
                ) : null}

                {formatFilterApproximate ? (
                  <p className="f9-wk-note" role="status">
                    Format filters are approximate for this source
                  </p>
                ) : null}

                {/* ROUND 2: a CAVEAT arrives before the material, a FOOTNOTE
                    after it. On a healthy check this line says "Live ad checks
                    are ready" — that is a footnote, and it repeats the
                    freshness the evidence pane already attaches to the
                    capture, so it moves below the rows with the rest of the
                    provenance. When discovery is degraded, cache-only or demo,
                    the same line is a caveat about what you are about to read
                    and it stays above, where you cannot miss it. */}
                {discoverySummary &&
                visibleAds.length > 0 &&
                visibleResult.discoveryStatus !== "healthy" &&
                // The partial-streaming progress banner below owns the
                // warming-with-results copy; suppress the generic footnote
                // here so the visitor sees one progress state, not two.
                !(isSearchWarming && visibleAds.length > 0) ? (
                  <p className="f9-wk-note">{discoverySummary}</p>
                ) : null}

                {/* BET 2 (issue 951): progressive streaming. The first batch
                    of ads landed from the initial Ad Library surface while the
                    scroll-and-collect passes keep running in the background.
                    Show a REAL progress state — the count so far plus an
                    honest "loading more" line — instead of an undifferentiated
                    spinner, so the visitor sees the first card in seconds and
                    knows more is coming. The live region announces the count
                    for screen readers as it grows. */}
                {isSearchWarming && visibleAds.length > 0 ? (
                  <div
                    className="f9-wk-progress"
                    aria-live="polite"
                    role="status"
                  >
                    <p className="f9-wk-lede">
                      {formatSearchTierProgressRow(visibleResult, {
                        totalVisible: visibleAds.length,
                        exhausted: warmingPollExhausted,
                      })}
                    </p>
                    <p className="f9-wk-note">
                      {warmingPollExhausted
                        ? "We stopped auto-refreshing. Retry this search to load the rest."
                        : "We'll refresh automatically as more ads come in."}
                    </p>
                  </div>
                ) : null}

                {visibleAds.length > 0 ? (
                  <RuledList aria-label="Search results">
                    {visibleAds.map((ad) => (
                      <SearchResultRow
                        key={ad.metaAdId}
                        ad={ad}
                        href={resultCardHref(ad.metaAdId)}
                        isActive={selectedAd?.metaAdId === ad.metaAdId}
                        isKeyFocused={keyFocusedAdId === ad.metaAdId}
                        canQuickSave={Boolean(data.session)}
                        collections={data.collections}
                        plan={data.plan}
                      />
                    ))}
                  </RuledList>
                ) : (
                  /* Honest states, designed rather than bolted on: warming says
                     it is still checking, delayed says the check is delayed,
                     and a real empty says what we looked for and what to try
                     next. No dimmed specimen — a diagram of the thing the
                     visitor does not have yet is the v3 ornament habit. */
                  <div className="f9-wk-empty">
                    {isSearchWarming ? (
                      <div aria-live="polite" role="status">
                        {warmingPollExhausted ? (
                          /* Honest end state: the check outlived the 60s
                             warming poll budget, so the promised auto-refresh
                             is off. Say that plainly and point at the retry
                             (which re-arms a fresh budget) instead of leaving
                             "we'll refresh automatically" up forever. */
                          <>
                            <p className="f9-wk-lede">
                              The check is taking longer than a minute
                            </p>
                            <p className="f9-wk-note">
                              We stopped auto-refreshing. Retry this search to
                              check again.
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="f9-wk-lede">
                              Checking the Ad Library now
                            </p>
                            {/* BET 2 progressive first card (issue 1471): the
                                tier-progress row for a truly cold search — the
                                count of verified rows so far follows the lead, so
                                a first payload with no cached rows says "0
                                verified" and one that landed a synchronous tier
                                says "N verified" instead of a spinner-only body.
                                The cold verify pass still runs in the background
                                and the poll merges the rest in place. */}
                            <p className="f9-wk-note">
                              {tierCounts.verified} verified · still checking —
                              Usually under a minute — we&rsquo;ll refresh
                              automatically.
                            </p>
                          </>
                        )}
                      </div>
                    ) : !searchAnswer ? (
                      <p className="f9-wk-note">
                        {isDelayedDiscoveryStatus(visibleResult.discoveryStatus)
                          ? (discoverySummary ??
                            "Fresh checks are delayed, so coverage may be incomplete.")
                          : isDomainSearch &&
                              data.relevanceApplied &&
                              !isBroaderScope
                            ? "We couldn't confirm any ads whose advertiser or landing page is connected to this website."
                            : (discoverySummary ??
                              "Try another competitor website.")}
                      </p>
                    ) : null}
                    {isSearchWarming ? (
                      <div className="f9-wk-acts">
                        <Link className="f9-wk-lnk" to={retrySearchPath}>
                          Retry this search{" "}
                          <span aria-hidden="true" className="f9-wk-chev">
                            &rsaquo;
                          </span>
                        </Link>
                        <Link className="f9-wk-lnk" to="/search">
                          Try another domain{" "}
                          <span aria-hidden="true" className="f9-wk-chev">
                            &rsaquo;
                          </span>
                        </Link>
                      </div>
                    ) : isDomainSearch && !isBroaderScope ? (
                      <div className="f9-wk-acts">
                        {rootData.session ? (
                          <Form className="f9-quick-track-form" method="post">
                            <input
                              name="intent"
                              type="hidden"
                              value="create-watchlist"
                            />
                            <SearchStateFields
                              competitorWebsite={competitorWebsite.raw}
                              filters={data.filters}
                              mode={data.mode}
                              trackingRole={trackingRole}
                            />
                            <input
                              name="name"
                              type="hidden"
                              value={`${inferredWatchlistName} watch`}
                            />
                            <SubmitButton
                              className="f9-wk-lnk"
                              intent="create-watchlist"
                              pendingLabel="Creating…"
                            >
                              Track this {targetNoun}
                            </SubmitButton>
                          </Form>
                        ) : null}
                        <Link
                          className="f9-wk-lnk"
                          to={`/search?${broaderSearchParams.toString()}`}
                        >
                          Search broader matches for “
                          {displayDomain.split(".")[0] ?? displayDomain}”{" "}
                          <span aria-hidden="true" className="f9-wk-chev">
                            &rsaquo;
                          </span>
                        </Link>
                        <Link className="f9-wk-lnk" to="/search">
                          Try another domain{" "}
                          <span aria-hidden="true" className="f9-wk-chev">
                            &rsaquo;
                          </span>
                        </Link>
                        <Link className="f9-wk-lnk" to="/app/watchlists">
                          View monitoring setup{" "}
                          <span aria-hidden="true" className="f9-wk-chev">
                            &rsaquo;
                          </span>
                        </Link>
                      </div>
                    ) : null}
                  </div>
                )}

                {/* BET 2 three-tier tail (issue 1482): the honest sentence
                    under the results that reflects the CURRENT three-tier
                    split. Re-rendered from the visible result every poll, so
                    it updates as rows stream in — a "3 verified · 1 likely ·
                    0 unmatched" footer that never overclaims what is
                    proven. Rows without tier metadata (legacy v1 payloads)
                    keep only the provenance footnote below. */}
                {visibleAds.length > 0 && tierTail ? (
                  <p className="f9-wk-small f9-tier-tail" role="status">
                    {tierTail}
                  </p>
                ) : null}

                {/* Provenance sits UNDER the results, not above them. It is
                    the footnote on the material — how many were verified,
                    whether the landing page was read, which source produced
                    them — and putting it above pushed the first row to 67% of
                    the viewport when every list this was calibrated against
                    starts its records inside 20%. */}
                {discoverySummary &&
                visibleAds.length > 0 &&
                visibleResult.discoveryStatus === "healthy" ? (
                  <p className="f9-wk-small">{discoverySummary}</p>
                ) : null}

                {searchAnswer ? (
                  <SearchAnswerPanel
                    answer={searchAnswer}
                    showHeadline={false}
                    steal={stealSummary}
                  />
                ) : null}

                {loadMoreParams ? (
                  <Form
                    aria-label={
                      retryingCursor
                        ? "Retry search results"
                        : "Load more search results"
                    }
                    className="f9-wk-more-results"
                    method="get"
                    action="/search"
                  >
                    <SearchQueryFields params={loadMoreParams} />
                    <SubmitButton
                      className="f9-wk-lnk"
                      getAction="/search"
                      match={{ after: loadMoreParams.get("after") ?? "" }}
                      pendingLabel="Loading…"
                    >
                      {retryingCursor ? "Retry" : "Load more"}
                    </SubmitButton>
                  </Form>
                ) : null}

              </section>
            </div>

            {selectedAd ? (
              <DetailPane
                className="f9-proof-summary"
                focusable
                id="selected-proof"
                label="Selected ad evidence"
                paneRef={selectedProofRef}
              >
                <DetailPaneHead
                  name={formatAdvertiserLabel(selectedAd.advertiser)}
                  site={
                    <>
                      <span className={selectedRunning ? "f9-wk-st is-on" : "f9-wk-st"}>
                        {formatAdActiveStatus(selectedAd)}
                      </span>
                      {selectedLongevity ? <> · {selectedLongevity}</> : null}
                    </>
                  }
                />

                <div className="f9-wk-creative">
                  <AdThumb ad={selectedAd} />
                  <h3 className="f9-wk-creative-head">
                    {scrubBrokenUnicode(selectedAd.previewHeadline)}
                  </h3>
                  <p className="f9-wk-quote">{formatAdDetailBody(selectedAd)}</p>
                </div>

                {/* Provenance is told ONCE per screen, and it belongs to the
                    capture: which source produced it, how fresh it is, and
                    whether the landing page was captured. */}
                <p className="f9-wk-prov">
                  <span>{formatSearchSourceLabel(visibleResult)}</span>
                  <span>{formatSearchFreshnessLabel(visibleResult)}</span>
                  <span>
                    {formatProofCaptureLabel(selectedAd, {
                      pending: selectionEnrichmentUiPending,
                      failureReason: data.landingPageCaptureFailure?.reasonCode,
                    })}
                  </span>
                </p>
                {selectedAd.domainMatch?.reason ? (
                  <p className="f9-wk-quote">{selectedAd.domainMatch.reason}</p>
                ) : null}
                {formatResultTierConfidence(selectedAd) ? (
                  <p className="f9-wk-note">{formatResultTierConfidence(selectedAd)}</p>
                ) : null}

                <DetailBlock kicker="What the ad says">
                  <DetailFacts
                    rows={[
                      { key: "Hook", value: scrubBrokenUnicode(selectedAd.hook) },
                      ...(selectedAdAngle
                        ? [
                            {
                              key: "Angle",
                              value: formatAngleDetail(selectedAdAngle),
                            },
                          ]
                        : []),
                      {
                        key: "Offer",
                        value: scrubBrokenUnicode(
                          formatOfferDisplay(selectedAd.offer),
                        ),
                      },
                      { key: "CTA", value: scrubBrokenUnicode(selectedAd.cta) },
                      {
                        key: "Format",
                        value: formatCreativeFormatLabel(selectedAd.format),
                      },
                      ...(selectedAd.variantCount && selectedAd.variantCount > 1
                        ? [
                            {
                              key: "Variants",
                              value: `${selectedAd.variantCount} running`,
                            },
                          ]
                        : []),
                      { key: "Language", value: selectedAd.languageLabel },
                      {
                        key: "Destination",
                        value: selectedAd.destinationType,
                      },
                    ]}
                  />
                  <p className="f9-wk-quote">
                    {creativeTextField
                      ? formatLandingPageSignalValue(
                          creativeTextField.fieldValue,
                        )
                      : selectionEnrichmentUiPending
                        ? "Analyzing creative…"
                        : formatLandingPageSignalValue(null)}
                  </p>
                  <p className="f9-wk-small">
                    {creativeTextField
                      ? "Text read straight from the ad creative."
                      : selectionEnrichmentUiPending
                        ? "Reading the ad creative now — this updates in a few seconds."
                        : "We couldn't read text off this creative."}
                  </p>
                </DetailBlock>

                <DetailBlock kicker="Landing page">
                  <h4 className="f9-wk-blk-head">
                    {formatSelectedLandingHeadline({
                      rawHeadline: selectedAd.landingPage?.rawHeadline,
                      landingPageUrl: selectedAd.landingPageUrl,
                      hasLandingPage: Boolean(selectedAd.landingPage),
                      pending: selectionEnrichmentUiPending,
                      failureReason: data.landingPageCaptureFailure?.reasonCode,
                    })}
                  </h4>
                  <DetailFacts
                    rows={[
                      {
                        key: "Primary CTA",
                        value: formatSelectedLandingFactValue({
                          capturedLabel: formatLandingPageSignalValue(
                            selectedAd.landingPage?.ctaText,
                          ),
                          landingPageUrl: selectedAd.landingPageUrl,
                          hasLandingPage: Boolean(selectedAd.landingPage),
                          pending: selectionEnrichmentUiPending,
                          failureReason: data.landingPageCaptureFailure?.reasonCode,
                        }),
                      },
                      {
                        key: "Visible price/offer",
                        value: formatSelectedLandingFactValue({
                          capturedLabel: formatLandingPageSignalValue(
                            selectedAd.landingPage?.priceText,
                          ),
                          landingPageUrl: selectedAd.landingPageUrl,
                          hasLandingPage: Boolean(selectedAd.landingPage),
                          pending: selectionEnrichmentUiPending,
                          failureReason: data.landingPageCaptureFailure?.reasonCode,
                        }),
                      },
                      {
                        key: "Form present",
                        value: formatSelectedLandingFactValue({
                          capturedLabel: formatLandingPageFormValue(
                            selectedAd.landingPage?.formPresent,
                          ),
                          landingPageUrl: selectedAd.landingPageUrl,
                          hasLandingPage: Boolean(selectedAd.landingPage),
                          pending: selectionEnrichmentUiPending,
                          failureReason: data.landingPageCaptureFailure?.reasonCode,
                        }),
                      },
                      {
                        key: "Page check",
                        value: formatSelectedLandingFactValue({
                          capturedLabel: formatCaptureMethodLabel(
                            selectedAd.landingPage?.captureMethod,
                          ),
                          landingPageUrl: selectedAd.landingPageUrl,
                          hasLandingPage: Boolean(selectedAd.landingPage),
                          pending: selectionEnrichmentUiPending,
                          failedPageCheck: true,
                          failureReason: data.landingPageCaptureFailure?.reasonCode,
                        }),
                      },
                    ]}
                  />
                  {!selectedAd.landingPage &&
                  selectedAd.landingPageUrl &&
                  !selectionEnrichmentUiPending ? (
                    <p className="f9-wk-small">
                      {
                        formatLandingPageCaptureGap(
                          data.landingPageCaptureFailure?.reasonCode,
                        ).detail
                      }
                    </p>
                  ) : null}
                  {selectedAd.landingPageUrl ? (
                    <a
                      className="f9-wk-url"
                      href={selectedAd.landingPageUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {selectedAd.landingPageUrl}
                    </a>
                  ) : (
                    <p className="f9-wk-small">
                      No landing-page link found on this ad.
                    </p>
                  )}
                </DetailBlock>

                <DetailBlock>
                  <p className="f9-wk-small">{selectedAd.researchSummary}</p>
                </DetailBlock>

                {data.session && data.collections.length > 0 ? (
                  <DetailBlock kicker="Save this ad">
                    <Form className="f9-save-stack" method="post">
                      <input
                        name="intent"
                        type="hidden"
                        value="save-to-collection"
                      />
                      <input
                        name="adId"
                        type="hidden"
                        value={selectedAd.metaAdId}
                      />
                      <label className="f9-wk-field">
                        <span className="f9-wk-lab">Collection</span>
                        <select
                          className="f9-wk-sel"
                          name="collectionId"
                          required
                        >
                          {data.collections.map((collection) => (
                            <option key={collection.id} value={collection.id}>
                              {collection.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="f9-wk-field">
                        <span className="f9-wk-lab">Note</span>
                        <textarea
                          className="f9-wk-in"
                          name="note"
                          placeholder="Why this ad matters"
                          rows={3}
                        />
                      </label>
                      <label className="f9-wk-field">
                        <span className="f9-wk-lab">Tags</span>
                        <input
                          className="f9-wk-in"
                          name="tags"
                          placeholder="discount, COD, creator-led"
                        />
                      </label>
                      <SubmitButton
                        className="f9-wk-lnk"
                        intent="save-to-collection"
                        pendingLabel="Saving…"
                      >
                        Save to collection
                      </SubmitButton>
                    </Form>
                  </DetailBlock>
                ) : data.session ? (
                  <DetailBlock kicker="Save this ad">
                    <p className="f9-wk-note">
                      Create a collection to save this ad with your notes and
                      tags.
                    </p>
                    <div className="f9-wk-acts">
                      <Link className="f9-wk-lnk" to="/app/collections">
                        Open collections{" "}
                        <span aria-hidden="true" className="f9-wk-chev">
                          &rsaquo;
                        </span>
                      </Link>
                    </div>
                  </DetailBlock>
                ) : (
                  /* The band below the split is the page's account ask and it
                     says the whole pitch. This block is about the capture in
                     front of you, so it says only what an account does to THIS
                     capture — the same sentence twice on one screen is the
                     duplication this rebuild spent a package removing. */
                  <DetailBlock kicker="Keep this evidence">
                    <p className="f9-wk-note">
                      This capture is a moment in time. An account keeps it and
                      re-checks {competitorWatchLabel} on a schedule, so the
                      next version can be compared against it.
                    </p>
                    <div className="f9-wk-acts">
                      <Link className="f9-wk-lnk" to={signupTrackingPath}>
                        Create account to track this competitor{" "}
                        <span aria-hidden="true" className="f9-wk-chev">
                          &rsaquo;
                        </span>
                      </Link>
                    </div>
                  </DetailBlock>
                )}
              </DetailPane>
            ) : null}
          </div>

          {/* THE RETENTION BAND — round 2's resolution of §9.1.
              -----------------------------------------------------------------
              WHY IT IS A BAND, AND WHY IT IS HERE. The page used to split this
              job in two: the signed-in retention actions sat ABOVE the results
              (asking you to watch a competitor before you had seen a single
              ad), and the anonymous signup sat at the foot of the LEFT COLUMN,
              which with a peek pane open ends ~1,000px above the pane and can
              land beside `See ads`. One job, two homes, neither of them the
              moment. It is now one page-level band below the whole split: the
              same sentence to both audiences — you have the material, now keep
              it working — and it is the last thing on the page in every state.

              WHY IT IS FILLED. The DNA says "exactly one per screen", and the
              v4 concepts never tested the word: both concept pages are 900px
              documents in a 900px viewport, so per-screen and per-page were the
              same number. The landing — the reference implementation of this
              entire language — disambiguates it: it draws TWO ink fills, the
              hero `.ld-command` submit and the `.ld-final` `Create account`
              submit, ~6,000px apart, each the only fill in its own viewport.
              So the law is ONE FILL PER VIEWPORT, and a fill marks the commit
              of a conversion moment. `See ads` is the instrument's commit; this
              is the page's second and last one, and it owns its own screen.
              `e2e/bl031-capture` enforces it by paint: it slides a
              viewport-height window down the document and fails the evidence
              set if any window ever holds two.

              WHY IT IS FILLED ONLY WHEN THE SEARCH FOUND SOMETHING. A commit is
              earned. An empty search has produced nothing to keep, its honest
              next steps already live in the empty block above, and its document
              is short enough that a fill here would sit in the same viewport as
              `See ads` — the law and the product argument give the same
              answer. */}
          {instrumentUsed ? (
            !data.session ? (
              <div className="f9-wk-retain f9-search-signup-cta">
                <p className="f9-wk-sec-title">
                  {hasResults
                    ? "Keep this competitor under watch"
                    : "Keep checking this competitor"}
                </p>
                <p className="f9-wk-retain-say">{signupCtaBody}</p>
                <div className="f9-wk-acts">
                  {hasResults ? (
                    <Link className="f9-wk-btn" to={signupTrackingPath}>
                      Create account
                    </Link>
                  ) : (
                    <Link className="f9-wk-lnk" to={signupTrackingPath}>
                      Create account{" "}
                      <span aria-hidden="true" className="f9-wk-chev">
                        &rsaquo;
                      </span>
                    </Link>
                  )}
                </div>
              </div>
            ) : canTrackCurrentCompetitor && hasResults ? (
              <div className="f9-wk-retain">
                <p className="f9-wk-sec-title">
                  Keep this competitor under watch
                </p>
                <p className="f9-wk-retain-say">
                  We&rsquo;ll check {competitorWatchLabel} on a schedule, save
                  the screenshots, and email you when the ads, the offer, or the
                  landing page moves.
                </p>
                <div className="f9-wk-acts is-row">
                  <Form className="f9-quick-track-form" method="post">
                    <input name="intent" type="hidden" value="create-watchlist" />
                    <SearchStateFields
                      competitorWebsite={competitorWebsite.raw}
                      filters={data.filters}
                      mode={data.mode}
                      trackingRole={trackingRole}
                    />
                    <input
                      name="name"
                      type="hidden"
                      value={`${inferredWatchlistName} watch`}
                    />
                    <SubmitButton
                      className="f9-wk-btn"
                      intent="create-watchlist"
                      pendingLabel="Creating…"
                    >
                      Track this {targetNoun}
                    </SubmitButton>
                  </Form>
                  {/* Rank 2, and it stays text: two fills in one band is the
                      bug the law is there to prevent, and saving the query is
                      the reversible half of this decision. */}
                  <details className="f9-wk-refine is-inline">
                    <summary>Save this search</summary>
                    <Form className="f9-save-query-form" method="post">
                      <input name="intent" type="hidden" value="save-query" />
                      <SearchStateFields
                        competitorWebsite={competitorWebsite.raw}
                        filters={data.filters}
                        mode={data.mode}
                        trackingRole={trackingRole}
                      />
                      <label className="f9-wk-field">
                        <span className="f9-wk-lab">Save search as</span>
                        <input
                          autoComplete="off"
                          className="f9-wk-in"
                          defaultValue={inferredWatchlistName}
                          name="name"
                          placeholder="Competitor research"
                          type="text"
                        />
                      </label>
                      <SubmitButton
                        className="f9-wk-lnk"
                        intent="save-query"
                        pendingLabel="Saving…"
                      >
                        Save search
                      </SubmitButton>
                    </Form>
                  </details>
                </div>
              </div>
            ) : null
          ) : null}
          </>
        ) : (
          /* Pre-search. The boringness budget: a quiet explanation and the one
             Rank-1 above it. No specimen, no dimmed sample card, no diagram of
             a result — the form IS the affordance and the sentence says what
             comes back.
             The scope copy below the fold is the response to the SEO engine's
             thin-content warning (dogfood 694ddbd68e95 / AI Answer Readiness
             69e1b4be47bf): honest, page-specific detail — what a search
             returns, proof, and the next step — without decorating the
             instrument. The copy avoids claiming current activity: the
             discovery cache can serve cached inventory, so the "right now"
             promise stays gated (PR #567). */
          <>
            <section
              aria-labelledby="search-idle-title"
              className="f9-wk-sec"
            >
              <p className="f9-wk-kick" id="search-idle-title">
                Nothing searched yet
              </p>
              <p className="f9-wk-lede">
                Paste a competitor website and press See ads. We check the Meta
                Ad Library for their ads, capture the offer from their landing
                page, and keep the capture — so the next time that offer moves,
                you can prove it.
              </p>
              <div className="f9-wk-acts">
                <Link className="f9-wk-lnk" to="/#demo">
                  See a proof brief{" "}
                  <span aria-hidden="true" className="f9-wk-chev">
                    &rsaquo;
                  </span>
                </Link>
              </div>
            </section>
            <section
              aria-labelledby="search-scope-title"
              className="f9-wk-sec"
            >
              <h2 className="f9-wk-sec-title" id="search-scope-title">
                What a search returns
              </h2>
              <p className="f9-wk-lede">
                The public preview searches Meta&rsquo;s Ad Library for the
                competitor&rsquo;s ads — across Facebook, Instagram, Audience
                Network, and Messenger — and keeps what it finds, so a later
                change is provable, not anecdotal.
              </p>
              <ul className="f9-search-scope-list">
                <li>
                  <strong>Current and recent ads</strong> — creative previews
                  with first-seen and last-active dates, filterable by country,
                  platform, creative type, status, and date range.
                </li>
                <li>
                  <strong>The offer, read off their landing page</strong> — the
                  hook and the offer are extracted from the page, and translated
                  when the creative is in another language.
                </li>
                <li>
                  <strong>The proof capture</strong> — each ad and its landing
                  page are saved with a timestamp, so next week&rsquo;s
                  comparison has today&rsquo;s evidence.
                </li>
              </ul>
              <p className="f9-wk-note">
                Coverage and freshness vary by advertiser and provider, and
                public searches are rate-limited to keep the free preview fair.
                Signing in is free: save the useful examples, start a watchlist
                that scans on a schedule, and get an email when the offer or
                the landing page moves.
              </p>
            </section>
          </>
        )}
      </DashboardPage>
    </DashboardShell>
  );
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
      {filters.pageId ? (
        <input name="pageId" type="hidden" value={filters.pageId} />
      ) : null}
    </>
  );
}

function SearchQueryFields({ params }: { params: URLSearchParams }) {
  return Array.from(params.entries()).map(([name, value], index) => (
    <input
      key={`${name}-${value}-${index}`}
      name={name}
      type="hidden"
      value={value}
    />
  ));
}

function canUseCanaryFreshLiveBypass(
  env: { CANARY_BYPASS_TOKEN?: string },
  request: Request,
  url: URL,
) {
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

export function HydrateFallback() {
  return <PublicSearchLoading />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  // Use the rate-limit-specific error UI when the loader threw a 429
  // with a retryAfter value in the body.
  const isRateLimitError =
    error &&
    typeof error === "object" &&
    "data" in error &&
    (error as { data?: { error?: string; retryAfter?: number } }).data?.error ===
      "rate_limited";
  if (isRateLimitError) {
    return <PublicSearchRateLimitError error={error} />;
  }
  return <PublicSearchError error={error} />;
}
