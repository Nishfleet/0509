import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useRouteLoaderData,
} from "react-router";
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { BrandWordmark } from "~/components/brand-wordmark";
import {
  applyWebsiteSearchFallback,
  emptyCompetitorWebsite,
  normalizeCompetitorWebsiteInput,
  watchlistFingerprint,
} from "~/lib/competitor-website";
import { sampleQueries } from "~/lib/demo-data";
import { demoProof } from "~/lib/demo-proof";
import {
  buildSearchParams,
  normalizeSavedQuery,
  parseSearchParams,
} from "~/lib/normalize";
import {
  formatCaptureMethodLabel,
  formatLandingPageFormValue,
  formatLandingPageSignalValue,
} from "~/lib/landing-page-display";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";
import type { RootLoaderData } from "~/root";
import type { AdRecord, SearchFilters, SearchResponse } from "~/lib/types";

const searchDescription =
  "Sign in to search competitor Meta ads, save useful examples, and track visible offer changes over time.";

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
  const url = new URL(request.url);
  const competitorWebsite = normalizeCompetitorWebsiteInput(url.searchParams.get("website") ?? "");
  const parsed = applyWebsiteSearchFallback(parseSearchParams(url.searchParams), competitorWebsite);
  const forceLive = canUseCanaryFreshLiveBypass(env, request, url);

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
    };
  }

  if (!session && parsed.filters.query && !forceLive) {
    const { enforcePublicSearchRateLimit } = await import("~/lib/rate-limit.server");
    const rateLimitResponse = await enforcePublicSearchRateLimit(request, env, context.cloudflare?.ctx);
    if (rateLimitResponse) {
      throw rateLimitResponse;
    }
  }

  const collections = session ? await listCollections(env, session.user.id) : [];

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
    };
  }

  const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");
  const { prepareSearchResultSelection } = await import("~/lib/search-selection.server");
  const customerMetaAdLibraryToken = session
    ? await (await import("~/lib/customer-meta.server")).getCustomerMetaAdLibraryToken(env, session.user.id)
    : null;
  const result = await searchAdsViaSourceResolver(
    env,
    normalizeSavedQuery(parsed.mode, parsed.filters),
    url.searchParams.get("after"),
    {
      purpose: "public_search",
      forceLive,
      ...(customerMetaAdLibraryToken ? { customerMetaAdLibraryToken } : {}),
    },
  );
  const { result: hydratedResult, selectedAd } = await prepareSearchResultSelection(
    env,
    result,
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
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { checkPlanLimit } = await import("~/lib/plan.server");
  const { addAdToCollection, createSavedQuery, createWatchlist } = await import("~/lib/data.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const competitorWebsite = normalizeCompetitorWebsiteInput(
    String(formData.get("competitorWebsite") ?? formData.get("website") ?? ""),
  );
  const normalizedQuery = applyWebsiteSearchFallback(
    normalizeSavedQuery(
    (String(formData.get("mode") ?? "advertiser") === "keyword" ? "keyword" : "advertiser"),
    {
      query: String(formData.get("query") ?? ""),
      country: String(formData.get("country") ?? "India"),
      platform: String(formData.get("platform") ?? "all"),
      creativeType: String(formData.get("creativeType") ?? "all") as SearchFilters["creativeType"],
      status: String(formData.get("status") ?? "all") as SearchFilters["status"],
      firstSeenFrom: String(formData.get("firstSeenFrom") ?? ""),
      lastSeenFrom: String(formData.get("lastSeenFrom") ?? ""),
    },
    ),
    competitorWebsite,
  );

  if ((intent === "save-query" || intent === "create-watchlist") && !normalizedQuery.filters.query) {
    return { ok: false, message: "Enter a competitor website or search term before saving or tracking it." };
  }

  if (intent === "save-query") {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) {
      return { ok: false, message: "Give the saved search a name first." };
    }

    await createSavedQuery(env, session.user.id, {
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
    const watchlistLimit = await checkPlanLimit(env, session.user.id, "watchlists");

    if (!watchlistLimit.allowed) {
      return {
        ok: false,
        error: "plan_limit_exceeded",
        limit: watchlistLimit.limit,
        current: watchlistLimit.current,
        message: "You have reached your competitor tracking limit.",
      };
    }

    let watchlist: Awaited<ReturnType<typeof createWatchlist>> = null;
    if (shouldUseAdvertiserMode) {
      watchlist = await createWatchlist(env, session.user.id, {
        name: queryName,
        targetType: "advertiser",
        targetId: competitorWebsite.normalizedUrl ?? normalizedQuery.filters.query,
        targetFingerprint: watchlistFingerprint(normalizedQuery, competitorWebsite),
        targetLabel: normalizedQuery.filters.query,
      });
    } else {
      const savedQuery = await createSavedQuery(env, session.user.id, {
        name: `${queryName} source`,
        mode: normalizedQuery.mode,
        filters: normalizedQuery.filters,
      });

      if (!savedQuery) {
        return { ok: false, message: "Could not prepare this competitor for tracking." };
      }

      watchlist = await createWatchlist(env, session.user.id, {
        name: queryName,
        targetType: "saved_query",
        targetId: savedQuery.id,
        targetFingerprint: watchlistFingerprint(normalizedQuery, competitorWebsite),
        targetLabel: normalizedQuery.filters.query || savedQuery.name,
      });
    }

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
      return { ok: false, message: "Choose a collection and ad before saving." };
    }

    const ad = JSON.parse(adJson) as AdRecord;
    await addAdToCollection(
      env,
      session.user.id,
      collectionId,
      ad,
      String(formData.get("note") ?? "").trim() || null,
      tags,
    );

    return { ok: true, message: `Saved ${ad.advertiser} to your collection.` };
  }

  return { ok: false, message: "Unknown search action." };
}

export default function SearchRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const rootData = useRouteLoaderData("root") as RootLoaderData;
  const creativeTextField = data.selectedAd?.analysisFields.find((field) => field.fieldKey === "ocr_text");
  const competitorWebsite = data.competitorWebsite ?? emptyCompetitorWebsite();
  const currentSearchParams = withCompetitorWebsite(
    buildSearchParams({
      mode: data.mode,
      filters: data.filters,
    }),
    competitorWebsite.raw,
  );
  const signupTrackingPath = `/auth/signup?redirectTo=${encodeURIComponent(`/search?${currentSearchParams.toString()}`)}`;
  const inferredWatchlistName = (competitorWebsite.displayName ?? data.filters.query) || "Competitor";
  const canTrackCurrentCompetitor = Boolean(data.filters.query);
  const discoverySummary = formatDiscoverySummary(data.result);
  const idleSearchMessage = rootData.session
    ? "Enter a competitor website to see ads and save what matters."
    : "Enter a competitor website to preview live ads. Create an account to save and track.";

  return (
    <main className="f9-search-page">
      <header className="f9-search-nav">
        <div className="f9-container f9-search-nav-inner">
          <Link className="f9-brand f9-search-brand" to="/" aria-label="Five to Nine home">
            <BrandWordmark />
          </Link>

          <nav className="f9-search-nav-links" aria-label="Search navigation">
            <Link to="/">Home</Link>
            <Link to="/search">Search</Link>
            {rootData.session ? (
              <Link className="f9-search-nav-pill" to="/app">
                Account
              </Link>
            ) : (
              <Link className="f9-search-nav-pill" to="/auth/signup?redirectTo=/search">
                Create account
              </Link>
            )}
          </nav>
        </div>
      </header>

      <section className="f9-search-hero">
        <div className="f9-search-gradient" aria-hidden="true" />
        <div className="f9-container f9-search-hero-grid">
          <div>
            <p className="f9-search-kicker">Competitor ads</p>
            <h1>Track competitor ads from one website.</h1>
            <p>
              Start with the site you care about. Five to Nine finds the ads behind it, saves useful
              examples, and keeps watching for offer changes.
            </p>
          </div>
          <div className="f9-search-intake-card">
            <span>Start here</span>
            <h2>Which website should we watch?</h2>
            <Form className="f9-hero-intake-form" method="get">
              <input name="mode" type="hidden" value="advertiser" />
              <input name="country" type="hidden" value={data.filters.country} />
              <input name="platform" type="hidden" value="all" />
              <input name="creativeType" type="hidden" value="all" />
              <input name="status" type="hidden" value="all" />
              <label className="f9-field is-primary">
                <span>Website to track</span>
                <input
                  defaultValue={competitorWebsite.raw}
                  name="website"
                  placeholder="https://nykaa.com"
                  type="text"
                />
              </label>
              <label className="f9-field">
                <span>Brand or search term</span>
                <input
                  defaultValue={data.filters.query}
                  name="query"
                  placeholder="Nykaa"
                  type="text"
                />
              </label>
              <div className="f9-action-row">
                <button className="f9-primary-button" type="submit">
                  See competitor ads
                </button>
                {!rootData.session ? (
                  <Link className="f9-secondary-button" to={signupTrackingPath}>
                    Create account to track
                  </Link>
                ) : null}
              </div>
            </Form>
            {canTrackCurrentCompetitor && rootData.session ? (
              <Form className="f9-quick-track-form" method="post">
                <input name="intent" type="hidden" value="create-watchlist" />
                <SearchStateFields
                  competitorWebsite={competitorWebsite.raw}
                  filters={data.filters}
                  mode={data.mode}
                />
                <input name="name" type="hidden" value={`${inferredWatchlistName} watch`} />
                <button className="f9-secondary-button" type="submit">
                  Track this competitor
                </button>
              </Form>
            ) : null}
            <p
              data-f9-result-cache-status={data.result.cacheStatus ?? "none"}
              data-f9-result-empty-reason={data.result.discoveryEmptyReason ?? "none"}
              data-f9-result-source={data.result.source}
            >
              {data.result.discoveryStatus === "disabled" ? idleSearchMessage : "Results: "}
              {data.result.discoveryStatus !== "disabled" ? (
                <strong>{formatSearchSourceLabel(data.result)}</strong>
              ) : null}
            </p>
          </div>
        </div>
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

          {discoverySummary ? (
            <div className="f9-discovery-banner">
              <span>Results update</span>
              <p>{discoverySummary}</p>
            </div>
          ) : null}

          <div className="f9-search-grid">
            <section className="f9-search-controls">
              <Form className="f9-search-form" method="get">
                <div className="f9-controls-head">
                  <span>Search</span>
                  <h2>Choose a competitor</h2>
                  <p>Enter a competitor site first. Use the brand field if its ad account uses a different name.</p>
                </div>

                <label className="f9-field is-primary">
                  <span>Competitor website</span>
                  <input
                    defaultValue={competitorWebsite.raw}
                    name="website"
                    placeholder="https://mamaearth.in"
                    type="text"
                  />
                  <small>This becomes the saved competitor when you track it.</small>
                </label>

                <div className="f9-mode-toggle">
                  <label className={data.mode === "advertiser" ? "is-active" : ""}>
                    <input
                      defaultChecked={data.mode === "advertiser"}
                      name="mode"
                      type="radio"
                      value="advertiser"
                    />
                    Advertiser
                  </label>
                  <label className={data.mode === "keyword" ? "is-active" : ""}>
                    <input
                      defaultChecked={data.mode === "keyword"}
                      name="mode"
                      type="radio"
                      value="keyword"
                    />
                    Keyword
                  </label>
                </div>

                <label className="f9-field">
                  <span>Brand or keyword</span>
                  <input defaultValue={data.filters.query} name="query" placeholder="nykaa, cod, whatsapp, festive sale" />
                </label>

                <div className="f9-field-grid">
                  <label className="f9-field">
                    <span>Country</span>
                    <select defaultValue={data.filters.country} name="country">
                      <option value="India">India</option>
                      <option value="all">All countries</option>
                    </select>
                  </label>
                  <label className="f9-field">
                    <span>Platform</span>
                    <select defaultValue={data.filters.platform} name="platform">
                      <option value="all">All platforms</option>
                      <option value="Instagram">Instagram</option>
                      <option value="Facebook">Facebook</option>
                      <option value="Messenger">Messenger</option>
                    </select>
                  </label>
                  <label className="f9-field">
                    <span>Creative type</span>
                    <select defaultValue={data.filters.creativeType} name="creativeType">
                      <option value="all">All</option>
                      <option value="image">Image</option>
                      <option value="video">Video</option>
                      <option value="carousel">Carousel</option>
                    </select>
                  </label>
                  <label className="f9-field">
                    <span>Status</span>
                    <select defaultValue={data.filters.status} name="status">
                      <option value="all">All</option>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </label>
                </div>

                <div className="f9-field-grid">
                  <label className="f9-field">
                    <span>First seen from</span>
                    <input defaultValue={data.filters.firstSeenFrom} name="firstSeenFrom" type="date" />
                  </label>
                  <label className="f9-field">
                    <span>Last seen from</span>
                    <input defaultValue={data.filters.lastSeenFrom} name="lastSeenFrom" type="date" />
                  </label>
                </div>

                <div className="f9-action-row">
                  <button className="f9-primary-button" type="submit">
                    Search ads
                  </button>
                  <Link
                    className="f9-secondary-button"
                    to={`/search?mode=${data.mode}&query=${encodeURIComponent(sampleQueries[data.mode][0])}`}
                  >
                    Example search
                  </Link>
                </div>
              </Form>

              <div className="f9-search-samples">
                <span>Try these</span>
                {sampleQueries[data.mode].map((query) => {
                  const params = buildSearchParams({
                    mode: data.mode,
                    filters: {
                      ...data.filters,
                      query,
                    },
                  });

                  return (
                    <Link key={query} to={`/search?${params.toString()}`}>
                      {query}
                    </Link>
                  );
                })}
              </div>

              {data.session ? (
                data.filters.query ? (
                  <div className="f9-save-stack">
                    <Form className="f9-inline-save" method="post">
                      <input name="intent" type="hidden" value="save-query" />
                      <SearchStateFields
                        competitorWebsite={competitorWebsite.raw}
                        filters={data.filters}
                        mode={data.mode}
                      />
                      <input name="name" placeholder="Save this search as..." required />
                      <button className="f9-secondary-button" type="submit">
                        Save search
                      </button>
                    </Form>

                    <Form className="f9-inline-save" method="post">
                      <input name="intent" type="hidden" value="create-watchlist" />
                      <SearchStateFields
                        competitorWebsite={competitorWebsite.raw}
                        filters={data.filters}
                        mode={data.mode}
                      />
                      <input
                        defaultValue={`${inferredWatchlistName} watch`}
                        name="name"
                        placeholder="Watchlist name"
                      />
                      <button className="f9-primary-button" type="submit">
                        Track this competitor
                      </button>
                    </Form>
                  </div>
                ) : (
                  <div className="f9-side-note">
                    <p>Enter a competitor website or brand, then save it or turn it into a watchlist.</p>
                  </div>
                )
              ) : (
                <div className="f9-side-note">
                  <span>Save the watch</span>
                  <p>
                    Preview live ads here. Create an account to save useful ads and keep tracking the competitor next week.
                  </p>
                  <PublicDigestPreview />
                  <Link className="f9-primary-button" to={signupTrackingPath}>
                    Create account
                  </Link>
                </div>
              )}
            </section>

            <section className="f9-results-panel">
              <div className="f9-panel-head">
                <div>
                  <span>Results</span>
                  <h2>{data.result.ads.length} ads found</h2>
                </div>
                {data.result.nextCursor ? (
                  <Link
                    className="f9-secondary-button"
                    to={`/search?${appendCursor(
                      withCompetitorWebsite(
                        buildSearchParams({
                          mode: data.mode,
                          filters: data.filters,
                        }),
                        competitorWebsite.raw,
                      ),
                      data.result.nextCursor,
                      data.selectedAd?.metaAdId ?? null,
                    ).toString()}`}
                  >
                    Load more
                  </Link>
                ) : null}
              </div>

              <div className="f9-results-list">
                {data.result.ads.length > 0 ? (
                  data.result.ads.map((ad) => (
                    <Link
                      className={`f9-result-card ${data.selectedAd?.metaAdId === ad.metaAdId ? "is-active" : ""}`}
                      key={ad.metaAdId}
                      to={`/search?${withSelected(
                        withCompetitorWebsite(
                          buildSearchParams({
                            mode: data.mode,
                            filters: data.filters,
                          }),
                          competitorWebsite.raw,
                        ),
                        ad.metaAdId,
                      ).toString()}`}
                    >
                      <div>
                        <span>{ad.advertiser}</span>
                        <h3>{ad.previewHeadline}</h3>
                      </div>
                      <p>{ad.hook}</p>
                      <small>
                        {ad.offer} · {ad.destinationType} · {ad.languageLabel}
                      </small>
                      <em>{ad.format}</em>
                    </Link>
                  ))
                ) : (
                  <div className="f9-empty-state">
                    <h3>{formatEmptyResultHeadline(data.result)}</h3>
                    <p>
                      {discoverySummary ??
                        "Try a broader query or switch between advertiser and keyword mode."}
                    </p>
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
                      <h2>{data.selectedAd.advertiser}</h2>
                    </div>
                    <em className={data.selectedAd.active ? "is-active" : ""}>
                      {data.selectedAd.active ? "Active" : "Inactive"}
                    </em>
                  </div>

                  <div className="f9-detail-hero">
                    <h3>{data.selectedAd.previewHeadline}</h3>
                    <p>{data.selectedAd.body}</p>
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
                      <button className="f9-primary-button" type="submit">
                        Save to collection
                      </button>
                    </Form>
                  ) : data.session ? (
                    <div className="f9-side-note">
                      <p>Create a collection first, then save ads from search.</p>
                      <Link className="f9-secondary-button" to="/app/collections">
                        Open collections
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
        </div>
      </section>
    </main>
  );
}

function PublicDigestPreview() {
  return (
    <div className="f9-public-digest-preview" aria-label="Example tracked competitor digest preview">
      <div>
        <strong>Example tracked competitor</strong>
        <span>{demoProof.trackedPreview.watchlistName}</span>
      </div>
      <dl>
        <div>
          <dt>Cadence</dt>
          <dd>{demoProof.trackedPreview.cadence}</dd>
        </div>
        <div>
          <dt>Proof trail</dt>
          <dd>{demoProof.trackedPreview.proofCount} signals</dd>
        </div>
        <div>
          <dt>Delivery</dt>
          <dd>{demoProof.trackedPreview.deliveryPreview}</dd>
        </div>
      </dl>
      <div>
        <strong>Digest preview</strong>
        <span>{demoProof.digestPreview.subject}</span>
      </div>
      <p>{demoProof.digestPreview.recommendedMove}</p>
      <a href="/api/demo-proof?format=markdown">Open example digest</a>
    </div>
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
}: {
  competitorWebsite?: string;
  mode: "advertiser" | "keyword";
  filters: SearchFilters;
}) {
  return (
    <>
      <input name="competitorWebsite" type="hidden" value={competitorWebsite} />
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

function formatSearchSourceLabel(result: SearchResponse) {
  if (result.discoveryStatus === "disabled") {
    return "Ready when you are";
  }

  if (result.discoveryStatus === "degraded" && result.ads.length === 0) {
    return "Fresh results delayed";
  }

  if (
    result.discoveryStatus === "cache_only" ||
    result.cacheStatus === "hit" ||
    result.cacheStatus === "stale"
  ) {
    return "Recent results";
  }

  if (result.source === "meta_library_browser") {
    return "Fresh results";
  }

  if (result.source === "meta_api") {
    return "Fresh results";
  }

  if (result.source === "meta") {
    return "Fresh results";
  }

  return "Sample results";
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
    .replace(/Browser Run/gi, "visual checks")
    .replace(/API fallback/gi, "alternate Meta ad results")
    .replace(/cached live results/gi, "recent results")
    .replace(/cached results/gi, "recent results");
}

function formatEmptyResultHeadline(result: SearchResponse) {
  if (result.discoveryStatus === "disabled") {
    return "Enter a competitor website or keyword";
  }

  if (result.discoveryStatus === "degraded") {
    return "Live search is temporarily unavailable";
  }

  return "No ads found for this query";
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
