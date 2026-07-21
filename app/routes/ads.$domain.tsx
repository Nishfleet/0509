/**
 * /ads/:domain — public programmatic brand pages (SEO acquisition engine).
 *
 * ZERO-COST CONSTRAINT: this page renders ONLY from the existing discovery
 * cache (`loadBrandPageCacheSnapshot` → bounded D1 reads). A public request
 * must NEVER trigger live scraping, Browser Rendering, Meta API calls, or any
 * other paid operation, for any input. Live refresh happens only when the
 * visitor explicitly follows the "Run a live search" CTA to /search.
 *
 * INDEXING FLAG (PUBLIC_BRAND_PAGES_INDEXABLE):
 *   - unset or "1" (the default posture): pages are indexable — fresh cached
 *     pages carry no robots meta.
 *   - "0": emergency brake — every /ads/* page carries
 *     <meta name="robots" content="noindex">.
 *   Regardless of the flag, these states ALWAYS carry noindex:
 *   - the cache-miss honest shell ("We haven't checked {domain} recently"),
 *   - demo-sourced cache entries (they render the shell anyway — sample data
 *     is never presented as a brand's real ads on a public page),
 *   - cache entries older than 7 days (stale pages still render with an
 *     honest freshness line but must not rank).
 *
 * SITEMAP: /ads/* is deliberately NOT in the static sitemap. When adding it,
 * generate entries dynamically from cached-fresh pages only — see the
 * commented block above SITEMAP_XML in app/lib/seo.ts for the exact strategy.
 */

import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import { AdLongevityPill } from "~/components/ad-longevity-pill";
import { AdThumb } from "~/components/ad-thumb";
import { BrandWordmark } from "~/components/brand-wordmark";
import { Pill } from "~/components/pill";
import type { BrandIntelTeaser } from "~/lib/brand-page.server";
import { canonicalUrl, publicSeoMeta } from "~/lib/seo";
import type { AdRecord } from "~/lib/types";

export interface BrandPageLoaderData {
  domain: string;
  brandName: string;
  hasCachedAds: boolean;
  ads: AdRecord[];
  checkedAgo: string | null;
  teaser: BrandIntelTeaser | null;
  noindex: boolean;
  canonicalPath: string;
}

export async function loader({ context, params, request }: LoaderFunctionArgs): Promise<BrandPageLoaderData> {
  const { normalizeBrandPageDomain } = await import("~/lib/brand-page.server");
  const brand = normalizeBrandPageDomain(params.domain);
  if (!brand) {
    throw new Response("Not Found", { status: 404 });
  }

  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);

  const { enforcePublicBrandPageRateLimit } = await import("~/lib/rate-limit.server");
  const rateLimitResponse = await enforcePublicBrandPageRateLimit(
    request,
    env,
    context.cloudflare?.ctx,
  );
  if (rateLimitResponse) {
    throw rateLimitResponse;
  }

  const {
    buildBrandIntelTeaser,
    formatBrandPageCheckedAgo,
    loadBrandPageCacheSnapshot,
  } = await import("~/lib/brand-page.server");
  const { defaultCountryForVisitor } = await import("~/lib/countries");
  const visitorCountry = defaultCountryForVisitor(
    (context.cloudflare as { country?: string | null } | undefined)?.country ??
      request.headers.get("cf-ipcountry"),
  );

  let snapshot: Awaited<ReturnType<typeof loadBrandPageCacheSnapshot>> = null;
  try {
    snapshot = await loadBrandPageCacheSnapshot(env, {
      domain: brand.domain,
      visitorCountry,
    });
  } catch (error) {
    // A cache-read hiccup must degrade to the honest shell, never a 500 and
    // never a live-provider fallback.
    console.warn("Brand page cache read failed; rendering the honest shell.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    snapshot = null;
  }

  const emergencyNoindex = env.PUBLIC_BRAND_PAGES_INDEXABLE?.trim() === "0";
  const noindex = emergencyNoindex || !snapshot || !snapshot.freshForIndexing;

  return {
    domain: brand.domain,
    brandName: brand.displayName,
    hasCachedAds: Boolean(snapshot),
    ads: snapshot?.ads ?? [],
    checkedAgo: snapshot ? formatBrandPageCheckedAgo(snapshot.fetchedAt) : null,
    teaser: snapshot ? buildBrandIntelTeaser(snapshot.ads) : null,
    noindex,
    canonicalPath: `/ads/${brand.domain}`,
  };
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) {
    return [
      { title: "Brand ads | Five to Nine" },
      { name: "robots", content: "noindex" },
    ];
  }

  const title = `${data.brandName} Facebook & Instagram ads right now | Five to Nine`;
  const description = data.hasCachedAds
    ? `See ${data.ads.length} Meta ${data.ads.length === 1 ? "ad" : "ads"} from ${data.brandName} (${data.domain}), from a public Ad Library check ${data.checkedAgo}. Get an email when their ads or offer change.`
    : `We haven't checked ${data.domain} recently. Run a free live Meta Ad Library search and track ${data.brandName}'s ads with Five to Nine.`;

  return [
    ...publicSeoMeta({ title, description, pathname: data.canonicalPath }),
    // links() cannot see route params in this router version, so the
    // canonical tag ships as a meta-descriptor link instead.
    { tagName: "link", rel: "canonical", href: canonicalUrl(data.canonicalPath) },
    ...(data.noindex ? [{ name: "robots", content: "noindex" }] : []),
  ];
};

export default function BrandAdsRoute() {
  const data = useLoaderData<typeof loader>();
  const liveSearchPath = `/search?website=${encodeURIComponent(data.domain)}`;
  const postSignupPath = `/app/onboard?website=${encodeURIComponent(data.domain)}`;
  const signupPath = `/auth/signup?redirectTo=${encodeURIComponent(postSignupPath)}`;

  return (
    <main className="f9-home f9-brand-ads-page">
      <header className="ld-nav">
        <Link className="ld-brand" to="/" aria-label="Five to Nine home">
          <BrandWordmark />
        </Link>
        <nav className="ld-nav-links" aria-label="Primary">
          <Link to={liveSearchPath}>Search preview</Link>
          <Link to="/#pricing">Pricing</Link>
        </nav>
        <nav className="ld-nav-actions" aria-label="Account">
          <Link className="f9-link-arrow" to="/auth/login">
            Sign in
          </Link>
          <Link className="ld-nav-pill" to="/auth/signup">
            Create account
          </Link>
        </nav>
      </header>

      {data.hasCachedAds ? (
        <BrandAdsResults data={data} liveSearchPath={liveSearchPath} signupPath={signupPath} />
      ) : (
        <BrandAdsShell data={data} liveSearchPath={liveSearchPath} />
      )}
    </main>
  );
}

function BrandAdsResults({
  data,
  liveSearchPath,
  signupPath,
}: {
  data: BrandPageLoaderData;
  liveSearchPath: string;
  signupPath: string;
}) {
  const teaser = data.teaser;

  return (
    <section className="f9-search-workspace" aria-labelledby="brand-ads-title">
      <div className="f9-container">
        <div className="f9-panel-head">
          <div>
            <span>Public Ad Library check</span>
            <h1 id="brand-ads-title">{`${data.brandName} — Meta ads they're running`}</h1>
            <small>{data.domain}</small>
          </div>
        </div>

        <div className="f9-discovery-banner">
          <p>
            {`Based on a public Ad Library check from ${data.checkedAgo} — `}
            <Link to={liveSearchPath}>refresh by searching live</Link>.
          </p>
        </div>

        {teaser ? (
          <dl className="f9-detail-grid f9-brand-teaser">
            <div>
              <dt>Ads in this check</dt>
              <dd>{teaser.totalCount}</dd>
            </div>
            <div>
              <dt>Marked active</dt>
              <dd>{teaser.activeCount}</dd>
            </div>
            {teaser.longestRunningHook && teaser.longestRunningDays !== null ? (
              <div>
                <dt>{`Longest-running hook (${teaser.longestRunningDays} ${teaser.longestRunningDays === 1 ? "day" : "days"})`}</dt>
                <dd>{teaser.longestRunningHook}</dd>
              </div>
            ) : null}
            {teaser.formats.length > 0 ? (
              <div>
                <dt>Formats</dt>
                <dd>{teaser.formats.join(", ")}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        <div className="f9-search-signup-cta">
          <div>
            <strong>{`Watch ${data.domain} — get an email when their ads or offer change`}</strong>
            <p>
              Create a free account and the first scan runs immediately. Every change lands in
              your inbox with the screenshot, page text, and link.
            </p>
          </div>
          <Link className="f9-primary-button" to={signupPath}>
            {`Watch ${data.domain}`}
          </Link>
        </div>

        <div className="f9-results-list">
          {data.ads.map((ad) => (
            <div className="f9-result-card" key={ad.metaAdId}>
              <AdThumb ad={ad} />
              <div className="f9-result-card-body">
                <div>
                  <span>{ad.advertiser?.trim() || data.brandName}</span>
                  <h2>{ad.previewHeadline}</h2>
                  <div className="f9-result-card-pills">
                    <AdLongevityPill ad={ad} />
                    {ad.variantCount && ad.variantCount > 1 ? (
                      <Pill variant="longevity">{`×${ad.variantCount} variants`}</Pill>
                    ) : null}
                  </div>
                </div>
                {ad.hook?.trim() ? <p>{ad.hook}</p> : null}
                <em>{ad.format}</em>
              </div>
            </div>
          ))}
        </div>

        <div className="f9-search-empty-actions">
          <Link className="f9-secondary-button" to={liveSearchPath}>
            Run a live search
          </Link>
        </div>
      </div>
    </section>
  );
}

function BrandAdsShell({
  data,
  liveSearchPath,
}: {
  data: BrandPageLoaderData;
  liveSearchPath: string;
}) {
  return (
    <section className="f9-search-workspace" aria-labelledby="brand-ads-title">
      <div className="f9-container">
        <div className="f9-empty-state">
          <h1 id="brand-ads-title">{`${data.brandName} on Five to Nine`}</h1>
          <p>{`We haven't checked ${data.domain} recently. Run a free live search to see the Meta ads they're running right now.`}</p>
          <div className="f9-search-empty-actions">
            <Link className="f9-primary-button" to={liveSearchPath}>
              Run a free live search
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
