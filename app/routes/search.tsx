import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useRouteLoaderData,
} from "react-router";
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { AdLongevityPill } from "~/components/ad-longevity-pill";
import { AdThumb } from "~/components/ad-thumb";
import { DashboardShell } from "~/components/dashboard-shell";
import { SubmitButton } from "~/components/submit-button";
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
import { defaultCountryForVisitor } from "~/lib/countries";
import {
  formatAdvertiserLabel,
  formatCaptureMethodLabel,
  formatLandingPageFormValue,
  formatLandingPageSignalValue,
} from "~/lib/landing-page-display";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";
import { normalizeWatchlistTrackingRole } from "~/lib/watchlist-role";
import type { RootLoaderData } from "~/root";
import type { AdRecord, SearchFilters, SearchResponse, WatchlistTrackingRole } from "~/lib/types";

const searchDescription =
  "Preview live competitor Meta ads before creating an account; sign in only when you want to save examples and track offer changes over time.";

export const links: LinksFunction = () => canonicalLinks("/search");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Search | Five to Nine",
    description: searchDescription,
    pathname: "/search",
  });

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getOptionalSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { listCollections } = await import("~/lib/data.server");
  const env = getEnv(context);
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
      collections: [],
      session,
      competitorWebsite,
      trackingRole,
      inputError: competitorWebsite.error,
      searchScope: "exact" as const,
      displayDomain: null,
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
      collections: [],
      session,
      competitorWebsite,
      trackingRole,
      inputError: null,
      searchScope: "exact" as const,
      displayDomain: null,
      ...navFlags,
    };
  }

  if (!session && parsed.filters.query && !forceLive) {
    const { enforcePublicSearchRateLimit } = await import("~/lib/rate-limit.server");
    const rateLimitResponse = await enforcePublicSearchRateLimit(request, env, context.cloudflare?.ctx);
    if (rateLimitResponse) {
      throw rateLimitResponse;
    }
  }

  if (session && parsed.filters.query && !forceLive) {
    const { enforceAuthenticatedSearchRateLimit } = await import("~/lib/rate-limit.server");
    const rateLimitResponse = await enforceAuthenticatedSearchRateLimit(
      request,
      env,
      session.user.id,
      context.cloudflare?.ctx,
    );
    if (rateLimitResponse) {
      throw rateLimitResponse;
    }
  }

  const collections = session ? await listCollections(env, workspaceUserId!) : [];

  if (!parsed.filters.query) {
    return {
      mode: parsed.mode,
      filters: parsed.filters,
      fingerprint: parsed.fingerprint,
      result: buildIdleSearchResult(),
      selectedAd: null,
      collections,
      session,
      competitorWebsite,
      trackingRole,
      inputError: null,
      searchScope: "exact" as const,
      displayDomain: null,
      ...navFlags,
    };
  }

  const { executeSearchWithRelevance } = await import("~/lib/search-execution.server");
  const { shouldApplySearchV2 } = await import("~/lib/search-rollout.server");
  const { prepareSearchResultSelection } = await import("~/lib/search-selection.server");
  const customerMetaAdLibraryToken = session
    ? await (await import("~/lib/customer-meta.server")).getCustomerMetaAdLibraryToken(env, workspaceUserId!)
    : null;

  const useSearchV2 = shouldApplySearchV2(env) && Boolean(competitorWebsite.raw);
  const searchExecution = useSearchV2
    ? await executeSearchWithRelevance({
        env,
        competitorWebsite,
        parsed,
        scope: searchScope,
        cursor: url.searchParams.get("after"),
        forceLive,
        customerMetaAdLibraryToken,
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
      };

  const { result: hydratedResult, selectedAd } = await prepareSearchResultSelection(
    env,
    searchExecution.result,
    url.searchParams.get("selected"),
    {
      enrichSelected: Boolean(session),
      hydratePersisted: Boolean(session),
    },
  );

  return {
    mode: parsed.mode,
    filters: parsed.filters,
    fingerprint: parsed.fingerprint,
    result: hydratedResult,
    selectedAd,
    collections,
    session,
    competitorWebsite,
    trackingRole,
    searchScope: searchExecution.searchScope,
    displayDomain: searchExecution.displayDomain,
    inputError: null,
    ...navFlags,
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { checkPlanLimit } = await import("~/lib/plan.server");
  const { addAdToCollection, createSavedQuery, createWatchlist } = await import("~/lib/data.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const workspaceUserId = (
    await (await import("~/lib/workspace.server")).resolveWorkspace(env, session.user.id)
  ).workspaceUserId;
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

    await createSavedQuery(env, workspaceUserId!, {
      name,
      mode: normalizedQuery.mode,
      filters: normalizedQuery.filters,
    });

    return { ok: true, message: `Saved ${name}.` };
  }

  if (intent === "create-watchlist") {
    const inferredName = (competitorWebsite.displayName ?? normalizedQuery.filters.query) || "Competitor";
    const queryName = String(formData.get("name") ?? "").trim() || `${inferredName} watch`;
    const shouldUseAdvertiserMode = canCreateAdvertiserWatchlist(normalizedQuery);
    const watchlistLimit = await checkPlanLimit(env, workspaceUserId, "watchlists");

    if (!watchlistLimit.allowed) {
      const isZeroLimit = watchlistLimit.limit === 0;
      return {
        ok: false,
        error: "plan_limit_exceeded",
        limit: watchlistLimit.limit,
        current: watchlistLimit.current,
        message: isZeroLimit
          ? "Retained competitor monitoring is available on paid plans. Starter is the recommended plan to track this competitor."
          : "You have reached your competitor tracking limit.",
        upgradePath: "/#pricing",
      };
    }

    let watchlist: Awaited<ReturnType<typeof createWatchlist>> = null;
    if (shouldUseAdvertiserMode) {
      watchlist = await createWatchlist(env, workspaceUserId!, {
        name: queryName,
        targetType: "advertiser",
        targetId: competitorWebsite.normalizedUrl ?? normalizedQuery.filters.query,
        targetFingerprint: watchlistFingerprint(normalizedQuery, competitorWebsite),
        targetLabel: competitorTrackingLabel(competitorWebsite, normalizedQuery.filters.query),
        targetCountry: normalizedQuery.filters.country,
        trackingRole,
      });
    } else {
      const savedQuery = await createSavedQuery(env, workspaceUserId!, {
        name: `${queryName} source`,
        mode: normalizedQuery.mode,
        filters: normalizedQuery.filters,
      });

      if (!savedQuery) {
        return { ok: false, message: "Could not prepare this competitor for tracking." };
      }

      watchlist = await createWatchlist(env, workspaceUserId!, {
        name: queryName,
        targetType: "saved_query",
        targetId: savedQuery.id,
        targetFingerprint: watchlistFingerprint(normalizedQuery, competitorWebsite),
        targetLabel: competitorTrackingLabel(competitorWebsite, normalizedQuery.filters.query) || savedQuery.name,
        targetCountry: normalizedQuery.filters.country,
        trackingRole,
      });
    }

    const { queueFirstWatchlistScan } = await import("~/lib/monitoring.server");
    queueFirstWatchlistScan(env, context.cloudflare?.ctx, watchlist);

    if (!watchlist) {
      return { ok: false, message: "Could not create this watchlist." };
    }

    throw redirect(`/app/watchlists?watchlist=${watchlist.id}`);
  }

  if (intent === "save-to-collection") {
    const collectionId = String(formData.get("collectionId") ?? "");
    const adJson = String(formData.get("adJson") ?? "");
    const tags = String(formData.get("tags") ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    if (!collectionId || !adJson) {
      return { ok: false, message: "Choose a board and ad before saving." };
    }

    const ad = JSON.parse(adJson) as AdRecord;
    await addAdToCollection(
      env,
      workspaceUserId!,
      collectionId,
      ad,
      String(formData.get("note") ?? "").trim() || null,
      tags,
    );

    return { ok: true, message: `Saved ${ad.advertiser?.trim() || "the ad"} to your board.` };
  }

  return { ok: false, message: "Unknown search action." };
}

export default function SearchRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const rootData = useRouteLoaderData("root") as RootLoaderData;
  const creativeTextField = data.selectedAd?.analysisFields.find((field) => field.fieldKey === "ocr_text");
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
  const signupTrackingPath = `/auth/signup?redirectTo=${encodeURIComponent(`/search?${currentSearchParams.toString()}`)}`;
  const inferredWatchlistName = (competitorWebsite.displayName ?? data.filters.query) || "Competitor";
  const canTrackCurrentCompetitor = Boolean(data.filters.query || competitorWebsite.normalizedUrl) && !data.inputError;
  const discoverySummary = formatDiscoverySummary(data.result);
  const hasSearchQuery = Boolean(data.filters.query || competitorWebsite.raw);
  const landingPageCount = data.result.ads.filter((ad) => ad.landingPage || ad.landingPageUrl).length;
  const displayDomain = data.displayDomain ?? competitorWebsite.host ?? competitorWebsite.raw;
  const isDomainSearch = Boolean(displayDomain && competitorWebsite.normalizedUrl);
  const isBroaderScope = data.searchScope === "broader";
  const broaderSearchParams = withTrackingContext(
    buildSearchParams({
      mode: data.mode,
      filters: data.filters,
    }),
    competitorWebsite.raw,
    trackingRole,
  );
  broaderSearchParams.set("broader", "1");

  return (
    <DashboardShell
      accountDetail={rootData.session ? "Saved searches and watches" : "Find competitor ads"}
      accountLabel={rootData.session ? "Workspace" : "Search"}
      accountTitle="Five to Nine"
      isPublic={!rootData.session}
      pageClassName="f9-search-page"
      railNote={
        data.result.ads.length > 0 ? (
          <div className="f9-cursor-rail-note">
            <span>Saved proof</span>
            <strong>
              {landingPageCount}/{data.result.ads.length}
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
              <input name="country" type="hidden" value={data.filters.country} />
              <input name="platform" type="hidden" value="all" />
              <input name="creativeType" type="hidden" value="all" />
              <input name="status" type="hidden" value="all" />
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
              <div className="f9-search-actions">
                <SubmitButton className="f9-primary-button" getAction="/search" pendingLabel="Searching…">
                  See ads
                </SubmitButton>
              </div>
            </Form>
            <p className="f9-search-command-hint" id="search-command-hint">
              {data.inputError ?? "Paste one competitor website."}
              {!rootData.session ? (
                <>
                  {" "}
                  <Link to={signupTrackingPath}>Create account</Link> to save searches.
                </>
              ) : null}
            </p>
            {canTrackCurrentCompetitor && rootData.session ? (
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
          </section>

      <section className="f9-search-workspace">
        <div className="f9-container">
          {actionData?.message ? (
            <div className={`f9-message ${actionData.ok ? "is-success" : "is-error"}`}>
              <p>
                {actionData.message}
                {"error" in actionData && actionData.error === "plan_limit_exceeded" ? (
                  <>
                    {" "}
                    <Link to="/#pricing">View plans</Link> to raise the limit.
                  </>
                ) : null}
              </p>
            </div>
          ) : null}

          {data.inputError ? (
            <div className="f9-message is-error">
              <p>{data.inputError}</p>
            </div>
          ) : null}

          {hasSearchQuery ? (
            <>
          <div className="f9-search-grid">
            <section
              className="f9-results-panel"
              data-f9-result-cache-status={data.result.cacheStatus ?? undefined}
              data-f9-result-empty-reason={data.result.discoveryEmptyReason ?? undefined}
              data-f9-result-source={data.result.provider ?? data.result.source}
            >
              <div className="f9-panel-head">
                <div>
                  <span>Results</span>
                  <h2>
                    {formatResultsPanelTitle(data.result, {
                      displayDomain,
                      isDomainSearch,
                      isBroaderScope,
                    })}
                  </h2>
                  {isDomainSearch && !isBroaderScope ? (
                    <small>{`Verified ads linked to ${displayDomain}`}</small>
                  ) : null}
                  {isDomainSearch && isBroaderScope ? (
                    <small>{`Broader matches related to ${displayDomain}`}</small>
                  ) : null}
                </div>
                {data.result.nextCursor ? (
                  <Link
                    className="f9-secondary-button"
                    to={`/search?${appendCursor(
                      withTrackingContext(
                        buildSearchParams({
                          mode: data.mode,
                          filters: data.filters,
                        }),
                        competitorWebsite.raw,
                        trackingRole,
                      ),
                      data.result.nextCursor,
                      data.selectedAd?.metaAdId ?? null,
                    ).toString()}`}
                  >
                    Load more
                  </Link>
                ) : null}
              </div>

              {discoverySummary && data.result.ads.length > 0 ? (
                <div className="f9-discovery-banner">
                  <p>{discoverySummary}</p>
                </div>
              ) : null}

              <div className="f9-results-list">
                {data.result.ads.length > 0 ? (
                  data.result.ads.map((ad) => (
                    <Link
                      className={`f9-result-card ${data.selectedAd?.metaAdId === ad.metaAdId ? "is-active" : ""}`}
                      key={ad.metaAdId}
                      to={`/search?${withSelected(
                        withTrackingContext(
                          buildSearchParams({
                            mode: data.mode,
                            filters: data.filters,
                          }),
                          competitorWebsite.raw,
                          trackingRole,
                        ),
                        ad.metaAdId,
                      ).toString()}`}
                    >
                      <AdThumb ad={ad} />
                      <div className="f9-result-card-body">
                        <div>
                          <span>{formatAdvertiserLabel(ad.advertiser)}</span>
                          <h3>{ad.previewHeadline}</h3>
                          <AdLongevityPill ad={ad} />
                        </div>
                        <p>{formatResultCardSummary(ad)}</p>
                        {ad.domainMatch?.reason ? <strong>{ad.domainMatch.reason}</strong> : null}
                        <small>
                          {ad.offer} · {ad.destinationType} · {ad.languageLabel}
                        </small>
                        <em>{ad.format}</em>
                      </div>
                    </Link>
                  ))
                ) : (
                  <div className="f9-empty-state">
                    <h3>
                      {formatEmptyResultHeadline(data.result, {
                        displayDomain,
                        isDomainSearch,
                        isBroaderScope,
                      })}
                    </h3>
                    <p>
                      {isDomainSearch && !isBroaderScope
                        ? "We couldn't confirm any ads whose advertiser or landing page is connected to this website."
                        : discoverySummary ?? "Try another competitor website."}
                    </p>
                    {isDomainSearch && !isBroaderScope ? (
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

            <aside className="f9-proof-detail">
              {data.selectedAd ? (
                <>
                  <div className="f9-panel-head">
                    <div>
                      <span>Ad details</span>
                      <h2>{formatAdvertiserLabel(data.selectedAd.advertiser)}</h2>
                      <AdLongevityPill ad={data.selectedAd} />
                    </div>
                    <em className={data.selectedAd.active ? "is-active" : ""}>
                      {data.selectedAd.active ? "Active" : "Inactive"}
                    </em>
                  </div>

                  <div className="f9-detail-hero">
                    <div className="f9-ad-thumb-row">
                      <AdThumb ad={data.selectedAd} />
                      <div>
                        <h3>{data.selectedAd.previewHeadline}</h3>
                        <p>{formatAdDetailBody(data.selectedAd)}</p>
                      </div>
                    </div>
                  </div>

                  <dl className="f9-detail-grid">
                    <DetailRow label="Hook" value={data.selectedAd.hook} />
                    <DetailRow label="Offer" value={data.selectedAd.offer} />
                    <DetailRow label="CTA" value={data.selectedAd.cta} />
                    <DetailRow label="Format" value={data.selectedAd.format} />
                    <DetailRow label="Language" value={data.selectedAd.languageLabel} />
                    <DetailRow label="Destination" value={data.selectedAd.destinationType} />
                  </dl>

                  <div className="f9-proof-block">
                    <span>Text in the ad</span>
                    <p>{formatLandingPageSignalValue(creativeTextField?.fieldValue)}</p>
                    <small>
                      {creativeTextField
                        ? "Read from the ad creative when available."
                        : "Not detected from the ad snapshot yet."}
                    </small>
                  </div>

                  <div className="f9-proof-block">
                    <span>Landing page</span>
                    <h3>{data.selectedAd.landingPage?.rawHeadline ?? "Headline not captured yet"}</h3>
                    <dl className="f9-detail-grid">
                      <DetailRow
                        label="Primary CTA"
                        value={formatLandingPageSignalValue(data.selectedAd.landingPage?.ctaText)}
                      />
                      <DetailRow
                        label="Visible price/offer"
                        value={formatLandingPageSignalValue(data.selectedAd.landingPage?.priceText)}
                      />
                      <DetailRow
                        label="Form present"
                        value={formatLandingPageFormValue(data.selectedAd.landingPage?.formPresent)}
                      />
                      <DetailRow
                        label="Page check"
                        value={formatCaptureMethodLabel(data.selectedAd.landingPage?.captureMethod)}
                      />
                    </dl>
                    {data.selectedAd.landingPageUrl ? (
                      <a href={data.selectedAd.landingPageUrl} rel="noreferrer" target="_blank">
                        {data.selectedAd.landingPageUrl}
                      </a>
                    ) : (
                      <small>No landing page URL detected.</small>
                    )}
                  </div>

                  <div className="f9-proof-block">
                    <span>Why this may matter</span>
                    <p>{data.selectedAd.researchSummary}</p>
                  </div>

                  {data.session && data.collections.length > 0 ? (
                    <Form className="f9-save-stack" method="post">
                      <input name="intent" type="hidden" value="save-to-collection" />
                      <input name="adJson" type="hidden" value={JSON.stringify(data.selectedAd)} />
                      <label className="f9-field">
                        <span>Board</span>
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
                        Save to board
                      </SubmitButton>
                    </Form>
                  ) : data.session ? (
                    <div className="f9-side-note">
                      <p>Create a board first, then save ads from search.</p>
                      <Link className="f9-secondary-button" to="/app/collections">
                        Open boards
                      </Link>
                    </div>
                  ) : null}
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

  if (/rate limited/i.test(result.discoverySummary)) {
    return result.discoverySummary
      .replace(/Commercial discovery/gi, "Competitor ad checks")
      .replace(/commercial discovery/gi, "competitor ad checks");
  }

  if (/degraded and no cached results are available/i.test(result.discoverySummary)) {
    return "Live search is delayed and no recent results are available.";
  }

  if (result.ads.length > 0 && /no cached results are available/i.test(result.discoverySummary)) {
    return "Live search is delayed; showing recent results.";
  }

  if (/Commercial discovery degraded; serving cached results/i.test(result.discoverySummary)) {
    return "Live search is delayed; showing recent results.";
  }

  if (/API fallback/i.test(result.discoverySummary)) {
    const fallbackUnavailable =
      result.discoveryStatus === "degraded" ||
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

function formatEmptyResultHeadline(
  result: SearchResponse,
  context: { displayDomain?: string | null; isDomainSearch?: boolean; isBroaderScope?: boolean } = {},
) {
  if (result.discoveryStatus === "disabled") {
    return "Enter a competitor website";
  }

  if (/warming this query|already warming/i.test(result.discoverySummary ?? "")) {
    return "Checking this competitor";
  }

  if (result.discoveryStatus === "degraded") {
    return "Live search is temporarily unavailable";
  }

  if (context.isDomainSearch && context.displayDomain && !context.isBroaderScope) {
    return `No verified ads found for ${context.displayDomain}`;
  }

  return "No ads found for this competitor";
}

function formatResultsPanelTitle(
  result: SearchResponse,
  context: { displayDomain?: string | null; isDomainSearch?: boolean; isBroaderScope?: boolean } = {},
) {
  if (result.ads.length > 0) {
    if (context.isDomainSearch && context.displayDomain && !context.isBroaderScope) {
      return `${result.ads.length} verified ads linked to ${context.displayDomain}`;
    }

    if (context.isBroaderScope && context.displayDomain) {
      return `${result.ads.length} broader matches for ${context.displayDomain}`;
    }

    return `${result.ads.length} ads found`;
  }

  if (/warming this query|already warming/i.test(result.discoverySummary ?? "")) {
    return "Search in progress";
  }

  if (context.isDomainSearch && context.displayDomain && !context.isBroaderScope) {
    return `No verified ads for ${context.displayDomain}`;
  }

  return "0 ads found";
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
