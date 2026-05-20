import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useRouteLoaderData,
} from "react-router";
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { BrandWordmark } from "~/components/brand-wordmark";
import { sampleQueries } from "~/lib/demo-data";
import {
  buildSearchParams,
  fingerprintSavedQuery,
  normalizeSavedQuery,
  parseSearchParams,
} from "~/lib/normalize";
import {
  formatAnalysisSourceLabel,
  formatCaptureMethodLabel,
  formatLandingPageFormValue,
  formatLandingPageSignalValue,
} from "~/lib/landing-page-display";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";
import type { RootLoaderData } from "~/root";
import type { AdRecord, SearchFilters, SearchResponse } from "~/lib/types";

const searchDescription =
  "Search competitor Meta ads, inspect the hook and offer, save the best examples, and turn useful queries into proof-backed watchlists.";

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
  const parsed = parseSearchParams(url.searchParams);
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
    };
  }

  const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");
  const { prepareSearchResultSelection } = await import("~/lib/search-selection.server");
  const forceLive = canUseCanaryFreshLiveBypass(env, request, url);
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
  );

  return {
    mode: parsed.mode,
    filters: parsed.filters,
    fingerprint: parsed.fingerprint,
    result: hydratedResult,
    selectedAd,
    collections,
    session,
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
  const normalizedQuery = normalizeSavedQuery(
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
  );

  if ((intent === "save-query" || intent === "create-watchlist") && !normalizedQuery.filters.query) {
    return { ok: false, message: "Run a search before saving or tracking it." };
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
    const queryName = String(formData.get("name") ?? "").trim() || `${normalizedQuery.filters.query || "Untitled"} watch`;
    const shouldUseAdvertiserMode = canCreateAdvertiserWatchlist(normalizedQuery);
    const watchlistLimit = await checkPlanLimit(env, session.user.id, "watchlists");

    if (!watchlistLimit.allowed) {
      return {
        ok: false,
        error: "plan_limit_exceeded",
        limit: watchlistLimit.limit,
        current: watchlistLimit.current,
        message: "You have reached your workspace watchlist limit.",
      };
    }

    if (shouldUseAdvertiserMode) {
      await createWatchlist(env, session.user.id, {
        name: queryName,
        targetType: "advertiser",
        targetId: normalizedQuery.filters.query,
        targetFingerprint: fingerprintSavedQuery(normalizedQuery),
        targetLabel: normalizedQuery.filters.query,
      });
    } else {
      const savedQuery = await createSavedQuery(env, session.user.id, {
        name: `${queryName} source`,
        mode: normalizedQuery.mode,
        filters: normalizedQuery.filters,
      });

      if (!savedQuery) {
        return { ok: false, message: "Could not create the source query for this watchlist." };
      }

      await createWatchlist(env, session.user.id, {
        name: queryName,
        targetType: "saved_query",
        targetId: savedQuery.id,
        targetFingerprint: savedQuery.fingerprint,
        targetLabel: savedQuery.name,
      });
    }

    return { ok: true, message: `Now tracking ${queryName}.` };
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
                Workspace
              </Link>
            ) : (
              <Link className="f9-search-nav-pill" to="/auth/signup?redirectTo=/search">
                Start now
              </Link>
            )}
          </nav>
        </div>
      </header>

      <section className="f9-search-hero">
        <div className="f9-search-gradient" aria-hidden="true" />
        <div className="f9-container f9-search-hero-grid">
          <div>
            <p className="f9-search-kicker">Public market search</p>
            <h1>Search competitor moves with proof attached.</h1>
            <p>
              Start with a brand, category term, or offer phrase. Five to Nine keeps source state, extraction method,
              and landing-page context visible before a signal becomes a decision.
            </p>
          </div>
          <div className="f9-search-source-card">
            <span>Current source state</span>
            <strong>{formatSearchSourceLabel(data.result)}</strong>
            <p>
              {data.result.discoverySummary ??
                "Search is ready. Results will label live, cached, degraded, or demo source paths."}
            </p>
          </div>
        </div>
      </section>

      <section className="f9-search-workspace">
        <div className="f9-container">
          {actionData?.message ? (
            <div className={`f9-message ${actionData.ok ? "is-success" : "is-error"}`}>
              <p>{actionData.message}</p>
            </div>
          ) : null}

          {data.result.discoverySummary ? (
            <div className="f9-discovery-banner">
              <span>Discovery status</span>
              <p>{data.result.discoverySummary}</p>
              {data.result.discoveryFailureClass ? (
                <small>Failure class: {formatFailureClass(data.result.discoveryFailureClass)}</small>
              ) : null}
            </div>
          ) : null}

          <div className="f9-search-grid">
            <section className="f9-search-controls">
              <Form className="f9-search-form" method="get">
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
                  <span>Search query</span>
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
                    Run search
                  </button>
                  <Link
                    className="f9-secondary-button"
                    to={`/search?mode=${data.mode}&query=${encodeURIComponent(sampleQueries[data.mode][0])}`}
                  >
                    Load example
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
                      <SearchStateFields filters={data.filters} mode={data.mode} />
                      <input name="name" placeholder="Save this search as..." required />
                      <button className="f9-secondary-button" type="submit">
                        Save search
                      </button>
                    </Form>

                    <Form className="f9-inline-save" method="post">
                      <input name="intent" type="hidden" value="create-watchlist" />
                      <SearchStateFields filters={data.filters} mode={data.mode} />
                      <input
                        defaultValue={`${data.filters.query} watch`}
                        name="name"
                        placeholder="Watchlist name"
                      />
                      <button className="f9-primary-button" type="submit">
                        Track this query
                      </button>
                    </Form>
                  </div>
                ) : (
                  <div className="f9-side-note">
                    <p>Run a search, then save it or turn it into a watchlist.</p>
                  </div>
                )
              ) : (
                <div className="f9-side-note">
                  <span>Workspace layer</span>
                  <p>
                    Search stays public. Saving queries, building watchlists, and sharing collections need a workspace
                    so the intelligence is still there next week.
                  </p>
                  <Link className="f9-primary-button" to="/auth/signup?redirectTo=/search">
                    Start now
                  </Link>
                </div>
              )}
            </section>

            <section className="f9-results-panel">
              <div className="f9-panel-head">
                <div>
                  <span>Results</span>
                  <h2>{data.result.ads.length} ads on this page</h2>
                </div>
                {data.result.nextCursor ? (
                  <Link
                    className="f9-secondary-button"
                    to={`/search?${appendCursor(
                      buildSearchParams({
                        mode: data.mode,
                        filters: data.filters,
                      }),
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
                        buildSearchParams({
                          mode: data.mode,
                          filters: data.filters,
                        }),
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
                      {data.result.discoverySummary ??
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
                      <span>Ad proof</span>
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
                    <span>Creative text</span>
                    <p>{formatLandingPageSignalValue(creativeTextField?.fieldValue)}</p>
                    <small>
                      {creativeTextField
                        ? `${formatAnalysisSourceLabel(creativeTextField.provenanceSource)} · best-effort creative extraction`
                        : "Not detected from the ad snapshot yet."}
                    </small>
                  </div>

                  <div className="f9-proof-block">
                    <span>Landing page intelligence</span>
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
                        label="Capture method"
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
                    <span>Analysis provenance</span>
                    <ul className="f9-field-list">
                      {data.selectedAd.analysisFields.map((field) => (
                        <li key={`${field.fieldKey}-${field.provenanceSource}`}>
                          <strong>{field.fieldKey.replaceAll("_", " ")}</strong>
                          <span>{field.fieldValue || "Not detected"}</span>
                          <small>
                            {field.provenanceSource} · v{field.extractorVersion.replace(/^v/, "")}
                          </small>
                        </li>
                      ))}
                    </ul>
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
                      <p>Create a collection in the workspace first, then save ads from search.</p>
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
  mode,
  filters,
}: {
  mode: "advertiser" | "keyword";
  filters: SearchFilters;
}) {
  return (
    <>
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
    return "Ready to search";
  }

  if (result.discoveryStatus === "degraded" && result.ads.length === 0) {
    return "Commercial discovery degraded";
  }

  if (
    result.discoveryStatus === "cache_only" ||
    result.cacheStatus === "hit" ||
    result.cacheStatus === "stale"
  ) {
    return "Cached live results";
  }

  if (result.source === "meta_library_browser") {
    return "Live Ad Library capture";
  }

  if (result.source === "meta_api") {
    return "Customer API fallback";
  }

  if (result.source === "meta") {
    return "Meta Ad Library";
  }

  return "Demo dataset";
}

function formatEmptyResultHeadline(result: SearchResponse) {
  if (result.discoveryStatus === "disabled") {
    return "Enter a competitor or keyword";
  }

  if (result.discoveryStatus === "degraded") {
    return "Live search is temporarily unavailable";
  }

  return "No ads found for this query";
}

function formatFailureClass(failureClass: string) {
  return failureClass.replaceAll("_", " ");
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
