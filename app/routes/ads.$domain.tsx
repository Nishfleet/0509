/**
 * /ads/:domain — public programmatic brand pages (SEO acquisition engine).
 *
 * ZERO-COST CONSTRAINT: this page renders ONLY from bounded D1 reads
 * (`loadBrandPageCacheSnapshot` for the ad wall, `loadOfferTimeline` for
 * the Offer Timeline). A public request must NEVER trigger live scraping,
 * Browser Rendering, Meta API calls, or any other paid operation, for any
 * input. Live refresh happens only when the visitor explicitly follows the
 * "Run a live search" CTA to /search.
 *
 * INDEXING FLAG (PUBLIC_BRAND_PAGES_INDEXABLE):
 *   - unset or "1" (the default posture): pages are indexable — fresh cached
 *     pages carry no robots meta.
 *   - "0": emergency brake — every /ads/* page carries
 *     <meta name="robots" content="noindex">.
 *   Regardless of the flag, these states ALWAYS carry noindex:
 *   - the cache-miss case 301-redirects to /search?q=<domain> (issue #1282:
 *     no page ships empty — see the redirect block in the loader),
 *   - demo-sourced cache entries (loadBrandPageCacheSnapshot filters them
 *     out → no snapshot → redirect),
 *   - cache entries older than 7 days (stale pages still render with an
 *     honest freshness line but must not rank),
 *   - a capture whose Ad Aggression Score cannot render (0 verified-linked
 *     ads, no first-seen date, or an observed window shorter than the 14-day
 *     floor) — the score is the page's named differentiator, so a page that
 *     ships the ad wall without it is indexable thin content. The wall still
 *     renders for a direct visitor; only indexability is withheld.
 *
 * DESIGN: the "Case File" system (see docs/ADS-PAGE-DIRECTIONS-2026-07-21.md).
 * Every number traces to a real loader field; sections render only when their
 * data exists (the score hides below the evidence floor, "What changed" hides
 * with no change events, Offer Timeline hides with no stored snapshots).
 * Honesty is the brand — no invented figures.
 *
 * SITEMAP: /ads/* is NOT in the static sitemap list — the live sitemap
 * appends dynamic entries generated from cached-fresh indexable pages only —
 * see app/lib/sitemap.server.ts and the comment block above SITEMAP_XML in
 * app/lib/seo.ts for the exact strategy.
 */

import { Link, redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import { AdCreative } from "~/components/ads/ad-creative";
import { BrandAdWall } from "~/components/ads/brand-ad-wall";
import { BrandChangeTimeline } from "~/components/ads/brand-change-timeline";
import { BrandScoreCard } from "~/components/ads/brand-score-card";
import { BrandStatLine } from "~/components/ads/brand-stat-line";
import { BrandTicker } from "~/components/ads/brand-ticker";
import { MarketingFooter } from "~/components/marketing-footer";
import { MarketingNav } from "~/components/marketing-nav";
import { OfferTimelineLedger } from "~/components/offer-timeline-ledger";
import { getOptionalCloudflareContext } from "~/lib/cloudflare-context";
import type {
  BrandChangeEvent,
  BrandIntelTeaser,
  BrandPageAggression,
} from "~/lib/brand-page.server";
import { countBrandOwnedAds } from "~/lib/brand-page.server";
import type { OfferLedgerEntry } from "~/lib/offer-timeline";
import type { DomainCaptureFailure } from "~/lib/offer-timeline.server";
import { formatCaptureAttemptReasonLabel } from "~/lib/capture-attempt-reason-code";
import {
  adsPageServiceJsonLd,
  canonicalUrl,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
} from "~/lib/seo";
import { SUPPORT_EMAIL } from "~/lib/support";
import type { AdRecord } from "~/lib/types";

export interface BrandPageLoaderData {
  domain: string;
  brandName: string;
  hasCachedAds: boolean;
  ads: AdRecord[];
  /**
   * The subset of `ads` that carry VERIFIED link evidence to the domain
   * (landing-page or advertiser-domain match). Attribution copy, the stat
   * line, and analytics are built ONLY from this subset — creatives that
   * merely match the search text are rendered but never described as linking.
   * Computed in the loader so the client bundle never touches the server-only
   * evidence module.
   */
  verifiedLinkedAds: AdRecord[];
  checkedAgo: string | null;
  /**
   * ISO timestamp of the underlying Ad Library check — the machine-readable
   * twin of the visible "Last checked …" stamp. Null on the cache-miss shell.
   */
  lastCheckedAt: string | null;
  /**
   * True only when the capture is young enough (still in the "moments ago"
   * bucket) for the page to honestly say "right now"/"live". Older captures —
   * even ones from a few minutes ago — render past-tense copy.
   */
  freshForLiveClaim: boolean;
  /**
   * How many of the cached creatives are ads the brand itself runs (advertiser
   * page named after the brand, or v2 advertiser evidence). When this is less
   * than the ad count, the rest are OTHER advertisers' ads that link to the
   * domain — the page must not claim the brand owns or runs them.
   */
  brandOwnedAdCount: number;
  /**
   * How many cached creatives carry VERIFIED link evidence to the domain
   * (landing-page or advertiser-domain match). Only these may be described as
   * "linking to" / "pointing at" / "running for" the domain.
   */
  verifiedLinkCount: number;
  /**
   * Cached creatives the provider returned for the domain WITHOUT verified
   * link evidence (text-mention and provider-candidate matches). These render
   * on the wall but are described as "matching the search", never as linking.
   */
  unverifiedMatchCount: number;
  teaser: BrandIntelTeaser | null;
  aggression: BrandPageAggression | null;
  changeEvents: BrandChangeEvent[];
  /**
   * Dated landing-page offer states for this domain. Empty when nothing is
   * stored yet — the Offer Timeline section hides in that case (never an
   * empty card). Seeded by migration 0079 for the five BET 3 demo brands.
   */
  offerTimelineEntries: OfferLedgerEntry[];
  /**
   * Country of the Ad Library the cached creatives came from ("India",
   * "United States", …) — or "all countries" for the all-countries view.
   * The Meta Ad Library is country-scoped, so this always names the library
   * the page's ads are actually from. Null on the cache-miss shell.
   */
  adLibraryCountry: string | null;
  noindex: boolean;
  canonicalPath: string;
  /**
   * Recent landing-page captures for this domain that did NOT produce an
   * alert — failed or skipped checks with a public reason code (issue #1289).
   * Read-only surface: a failed capture is never an alert, but it is visible
   * so the silence is provable. Empty when nothing is stored yet.
   */
  captureFailures: DomainCaptureFailure[];
}

export async function loader({ context, params, request }: LoaderFunctionArgs): Promise<BrandPageLoaderData> {
  const { normalizeBrandPageDomain } = await import("~/lib/brand-page.server");
  const brand = normalizeBrandPageDomain(params.domain);
  if (!brand) {
    throw new Response("Not Found", { status: 404 });
  }

  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const cloudflare = getOptionalCloudflareContext(context);

  const { enforcePublicBrandPageRateLimit } = await import("~/lib/rate-limit.server");
  const rateLimitResponse = await enforcePublicBrandPageRateLimit(
    request,
    env,
    cloudflare?.ctx,
  );
  if (rateLimitResponse) {
    throw rateLimitResponse;
  }

  const {
    adHasVerifiedDomainLink,
    brandPageAdLibraryCountryLabel,
    buildBrandChangeFeed,
    buildBrandIntelTeaser,
    computeBrandPageAggressionScore,
    loadBrandPageCacheSnapshot,
    resolveBrandPageFreshness,
  } = await import("~/lib/brand-page.server");
  const { defaultCountryForVisitor } = await import("~/lib/countries");
  const { loadOfferTimeline } = await import("~/lib/offer-timeline.server");
  const visitorCountry = defaultCountryForVisitor(
    cloudflare?.country ??
      request.headers.get("cf-ipcountry"),
  );

  let snapshot: Awaited<ReturnType<typeof loadBrandPageCacheSnapshot>> = null;
  try {
    snapshot = await loadBrandPageCacheSnapshot(env, {
      domain: brand.domain,
      visitorCountry,
    });
  } catch (error) {
    // A cache-read hiccup must degrade to the redirect below, never a 500 and
    // never a live-provider fallback.
    console.warn("Brand page cache read failed; redirecting to /search.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    snapshot = null;
  }

  // Issue #1282 — "no page ships empty" (transformation roadmap §3.5).
  //
  // A cache-miss /ads/:domain used to render a noindex "We haven't watched
  // {domain} yet" shell — the worst possible first impression for a buyer who
  // searched "{brand} Facebook ads" and landed here from Google.  Instead,
  // 301-redirect to /search?q=<domain> so the buyer lands on a page where
  // they can run a live search immediately.  This removes the noindex empty
  // shell from the live URL space entirely (the sitemap already excluded it;
  // the URL-space gap is now closed at the route too).
  //
  // The redirect fires ONLY for the true cache-miss case (!snapshot):
  //   - no cache entry at all (saucony.com, asics.com — the issue's targets),
  //   - demo-sourced entries (filtered out by loadBrandPageCacheSnapshot),
  //   - scheduled-scan / warmup entries (filtered out — public_search only),
  //   - cache older than 30 days (BRAND_PAGE_MAX_CACHE_AGE_MS).
  //
  // Pages with a real snapshot that are noindex for OTHER reasons still
  // render their ad wall — they have real content for a direct visitor, only
  // indexability is withheld:
  //   - emergency brake (PUBLIC_BRAND_PAGES_INDEXABLE=0),
  //   - stale > 7 days but < 30 days (!snapshot.freshForIndexing),
  //   - aggression score unavailable (aggression === null — sub-14-day window
  //     or 0 verified-linked ads).
  if (!snapshot) {
    throw redirect(`/search?q=${encodeURIComponent(brand.domain)}`, 301);
  }

  let offerTimelineEntries: OfferLedgerEntry[] = [];
  try {
    const loaded = await loadOfferTimeline(env, { domain: brand.domain, asOf: null });
    offerTimelineEntries = loaded.entries;
  } catch (error) {
    // Timeline is a secondary surface. A D1 hiccup must hide the section,
    // never 500 the ads page or trigger a live capture.
    console.warn("Brand page offer timeline read failed; hiding the section.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }

  // Issue #1289: surface failed/suppressed landing-page captures for this
  // domain so the public page names what we checked and why it did not
  // become an alert. Bounded D1 read; degrades to empty on any failure.
  const { loadDomainCaptureFailures } = await import("~/lib/offer-timeline.server");
  const captureFailures = await loadDomainCaptureFailures(env, { domain: brand.domain });

  const now = new Date();
  const freshness = snapshot
    ? resolveBrandPageFreshness(snapshot.fetchedAt, now)
    : null;
  const emergencyNoindex = env.PUBLIC_BRAND_PAGES_INDEXABLE?.trim() === "0";

  // Attribution analytics (score, teaser, change feed, ownership) derive ONLY
  // from creatives with verified link evidence. Ads the provider returned as
  // text-mention / provider candidates may be real creatives, but they are not
  // the searched brand's ads — no score or "what changed" may be built on
  // them. They still render on the wall, labeled as matching the search.
  const snapshotAds = snapshot?.ads ?? [];
  const verifiedLinkedAds = snapshot
    ? snapshotAds.filter((ad) => adHasVerifiedDomainLink(ad, brand.domain))
    : [];

  // The Ad Aggression Score (0–100, four public sub-scores) is the page's
  // named differentiator (category-research §1.2). It renders ONLY when the
  // capture has at least one verified-linked ad AND the observed window
  // clears the 14-day floor — `computeBrandPageAggressionScore` returns null
  // otherwise (0 verified-linked ads, no first-seen date, or a window shorter
  // than MIN_AGGRESSION_WINDOW_DAYS). A page that ships the ad wall without
  // its proprietary score is indexable thin content, so it self-noindexes:
  // no indexable thin brand page remains in the sitemap. The wall still
  // renders for a human who navigated directly — this is about indexability,
  // not hiding the page.
  const aggression = snapshot ? computeBrandPageAggressionScore(verifiedLinkedAds, now) : null;
  const noindex =
    emergencyNoindex || !snapshot || !snapshot.freshForIndexing || aggression === null;

  return {
    domain: brand.domain,
    brandName: brand.displayName,
    hasCachedAds: Boolean(snapshot),
    ads: snapshotAds,
    verifiedLinkedAds,
    checkedAgo: freshness?.checkedAgo ?? null,
    lastCheckedAt: snapshot?.fetchedAt ?? null,
    freshForLiveClaim: freshness?.freshForLiveClaim ?? false,
    brandOwnedAdCount: countBrandOwnedAds(verifiedLinkedAds, brand.domain),
    verifiedLinkCount: verifiedLinkedAds.length,
    unverifiedMatchCount: snapshotAds.length - verifiedLinkedAds.length,
    teaser: snapshot ? buildBrandIntelTeaser(verifiedLinkedAds, now) : null,
    aggression,
    changeEvents: snapshot ? buildBrandChangeFeed(verifiedLinkedAds, now) : [],
    offerTimelineEntries,
    adLibraryCountry: snapshot ? brandPageAdLibraryCountryLabel(snapshot.country) : null,
    noindex,
    canonicalPath: `/ads/${brand.domain}`,
    captureFailures,
  };
}

/**
 * Single source of truth for the page title — shared by the <title>/og:title
 * meta and the WebPage JSON-LD `name` so structured data always states exactly
 * what the visible page states.
 */
export function brandPageTitle(data: BrandPageLoaderData): string {
  // "Right now" is a live-scrape claim — it must never appear when the page
  // renders from a cache older than the "moments ago" window, or on the
  // cache-miss shell, and it needs the visible checked-ago stamp as its
  // evidence.
  if (!data.hasCachedAds) {
    return `${data.brandName} Facebook & Instagram ads | Five to Nine`;
  }
  // "{Brand} ads" is an ownership claim — only safe when every cached creative
  // is actually the brand's own. "Linking to" is a link claim — only safe when
  // the capture carries verified link evidence. Captures that only MATCH the
  // search (text-mention / provider candidates) must say so, never "linking".
  const allBrandOwned =
    data.ads.length > 0 && data.brandOwnedAdCount === data.ads.length;
  let subject: string;
  if (allBrandOwned) {
    subject = `${data.brandName} Facebook & Instagram ads`;
  } else if (data.verifiedLinkCount === 0) {
    subject = `${data.brandName}: Meta ads matching ${data.domain}`;
  } else if (data.unverifiedMatchCount > 0) {
    subject = `${data.brandName}: Meta ads linking to ${data.domain} and more matching it`;
  } else {
    subject = `${data.brandName}: Meta ads linking to ${data.domain}`;
  }
  if (data.freshForLiveClaim && data.checkedAgo) {
    return `${subject} right now | Five to Nine`;
  }
  return `${subject} — checked ${data.checkedAgo ?? "recently"} | Five to Nine`;
}

/**
 * Honest Ad Library source phrase for page copy, from the snapshot country:
 * "the India Ad Library" for a named country, "the Meta Ad Library's
 * all-countries query" for the all-countries view. The Meta Ad Library is
 * country-scoped, so this always names the library the cached creatives
 * actually came from (the loader geo-defaults the lookup — the copy must
 * not). The all-countries value is a single `country=ALL` query, not a
 * union of every market, so the copy names it as one query rather than
 * implying worldwide coverage. The fallback never renders for a populated
 * page; it exists only to keep the copy grammatical if a snapshot ever
 * lacks a country.
 */
export function adLibrarySourcePhrase(adLibraryCountry: string | null): string {
  if (adLibraryCountry && adLibraryCountry !== "all countries") {
    return `the ${adLibraryCountry} Ad Library`;
  }
  return "the Meta Ad Library's all-countries query";
}

/**
 * The same source phrase with the "public" qualifier used by the closer
 * honesty line: "the public India Ad Library" / "the public Meta Ad
 * Library's all-countries query".
 */
export function publicAdLibrarySourcePhrase(adLibraryCountry: string | null): string {
  if (adLibraryCountry && adLibraryCountry !== "all countries") {
    return `the public ${adLibraryCountry} Ad Library`;
  }
  return "the public Meta Ad Library's all-countries query";
}

/**
 * Single source of truth for the meta description — shared by the
 * <meta name="description"> and the WebPage JSON-LD `description`. The copy
 * names the country of the Ad Library the cached creatives came from.
 */
export function brandPageDescription(data: BrandPageLoaderData): string {
  if (!data.hasCachedAds) {
    return `We haven't checked ${data.domain} recently. Run a free live Meta Ad Library search and track ${data.brandName}'s ads with Five to Nine.`;
  }
  const totalCount = data.ads.length;
  const adWord = totalCount === 1 ? "ad" : "ads";
  // Only verified-from-other advertisers count as "other advertisers" in the
  // breakdown — unverified text-matches get their own labelled tail, never
  // the "from other advertisers" clause. The prefix already names
  // verifiedLinkCount, so the breakdown must sum to it (X + Y == V).
  const otherCount = data.verifiedLinkCount - data.brandOwnedAdCount;
  const linkWord = data.verifiedLinkCount === 1 ? "ad" : "ads";
  const unverifiedWord = data.unverifiedMatchCount === 1 ? "ad" : "ads";
  const check = `a public check of ${adLibrarySourcePhrase(data.adLibraryCountry)} ${data.checkedAgo}`;
  const unverifiedTail =
    data.unverifiedMatchCount > 0
      ? ` Another ${data.unverifiedMatchCount} ${unverifiedWord} matched the search without a verified link to ${data.domain}.`
      : "";
  if (data.verifiedLinkCount === 0) {
    return `See ${totalCount} Meta ${adWord} matching ${data.domain}, from ${check}. Their link to the site is not verified. Get an email when the ads or offers change.`;
  }
  if (totalCount > 0 && data.brandOwnedAdCount === totalCount) {
    return `See ${totalCount} Meta ${adWord} from ${data.brandName} (${data.domain}), from ${check}. Get an email when their ads or offer change.${unverifiedTail}`;
  }
  if (data.brandOwnedAdCount === 0) {
    return `See ${data.verifiedLinkCount} Meta ${linkWord} from other advertisers linking to ${data.domain}, from ${check}. Get an email when the ads or offers change.${unverifiedTail}`;
  }
  // When every verified linking creative is the brand's own (no
  // verified-from-other), drop the "and Y from other advertisers" clause —
  // the unverified matches appear only in the tail.
  const otherClause =
    otherCount > 0 ? ` and ${otherCount} from other advertisers` : "";
  return `See ${data.verifiedLinkCount} Meta ${linkWord} linking to ${data.domain} — ${data.brandOwnedAdCount} from ${data.brandName}${otherClause} — from ${check}. Get an email when the ads or offers change.${unverifiedTail}`;
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  if (!loaderData) {
    return [
      { title: "Brand ads | Five to Nine" },
      { name: "robots", content: "noindex" },
    ];
  }

  const title = brandPageTitle(loaderData);
  const description = brandPageDescription(loaderData);

  return [
    ...publicSeoMeta({ title, description, pathname: loaderData.canonicalPath }),
    // links() cannot see route params in this router version, so the
    // canonical tag ships as a meta-descriptor link instead.
    { tagName: "link", rel: "canonical", href: canonicalUrl(loaderData.canonicalPath) },
    ...(loaderData.noindex ? [{ name: "robots", content: "noindex" }] : []),
  ];
};

export default function BrandAdsRoute() {
  const data = useLoaderData<typeof loader>();
  const liveSearchPath = `/search?website=${encodeURIComponent(data.domain)}`;
  const postSignupPath = `/app?website=${encodeURIComponent(data.domain)}#setup-checklist`;
  const signupPath = `/auth/signup?redirectTo=${encodeURIComponent(postSignupPath)}`;
  const allBrandOwned =
    data.ads.length > 0 && data.brandOwnedAdCount === data.ads.length;

  return (
    <main className="f9-home f9-ads-page">
      {/*
       * Truthful WebPage + Service JSON-LD, and ONLY on indexable pages: the
       * honest shell, demo-sourced entries, stale (> 7 days) captures, and
       * the emergency-brake flag all carry noindex — structured data on
       * those states would be dead weight at best and a freshness lie at
       * worst. Every field mirrors the visible page: the meta
       * title/description, the canonical URL, the on-screen "Last checked"
       * stamp (dateModified), the brand the page is about, and the Watch
       * {domain} offer with Five to Nine as the provider.
       */}
      {!data.noindex ? (
        <>
          <script
            {...jsonLdScriptProps(
              webPageJsonLd({
                name: brandPageTitle(data),
                description: brandPageDescription(data),
                pathname: data.canonicalPath,
                dateModified: data.lastCheckedAt ?? undefined,
                aboutName: data.brandName,
              }),
            )}
          />
          <script
            {...jsonLdScriptProps(
              adsPageServiceJsonLd({
                brandName: data.brandName,
                domain: data.domain,
                description: brandPageDescription(data),
                pathname: data.canonicalPath,
              }),
            )}
          />
        </>
      ) : null}
      {data.hasCachedAds ? (
        <BrandTicker
          ads={data.ads}
          // The ticker tag names the brand only when the creatives are its
          // own; otherwise it tags the domain the ads link to.
          brandName={allBrandOwned ? data.brandName : data.domain}
          fresh={data.freshForLiveClaim}
        />
      ) : null}
      <MarketingNav />

      {data.hasCachedAds ? (
        <BrandAdsResults data={data} liveSearchPath={liveSearchPath} signupPath={signupPath} />
      ) : (
        <BrandAdsShell data={data} liveSearchPath={liveSearchPath} signupPath={signupPath} />
      )}

      <MarketingFooter />
    </main>
  );
}

/**
 * Offer Timeline on the public `/ads/:domain` page. Hidden when nothing is
 * stored (never an empty card). Seeded rows carry the honest
 * "Captured on <date>, no screenshot" label instead of a fake screenshot.
 */
function BrandOfferTimeline({
  domain,
  entries,
}: {
  domain: string;
  entries: OfferLedgerEntry[];
}) {
  if (entries.length === 0) {
    return null;
  }

  const stateWord = entries.length === 1 ? "dated state" : "dated states";
  return (
    <section className="f9-ads-sec" aria-labelledby="brand-offer-timeline-title">
      <div className="f9-container">
        <div className="f9-ads-sec-head">
          <div className="f9-ads-sec-head-left">
            <span className="f9-ads-sec-eyebrow">Landing-page offers</span>
            <h2 id="brand-offer-timeline-title">Offer timeline</h2>
          </div>
          <span className="f9-ads-sec-meta">
            {`${entries.length} ${stateWord} on record`}
          </span>
        </div>
        <OfferTimelineLedger entries={entries} />
        <p className="f9-timeline-also">
          <Link to={`/timeline/${encodeURIComponent(domain)}`}>{`Full offer timeline for ${domain}`}</Link>
        </p>
      </div>
    </section>
  );
}

/**
 * Capture-failure visibility on the public `/ads/:domain` page (issue #1289,
 * accept criterion #3). Lists recent landing-page checks that did NOT
 * produce an alert — failed or skipped captures with a public reason — so a
 * buyer can see what was checked and why the silence is real. Read-only: a
 * failed capture is never an alert, but it is never hidden either. Hidden
 * when nothing is stored (never an empty card).
 */
function BrandCaptureFailures({
  failures,
}: {
  failures: DomainCaptureFailure[];
}) {
  if (failures.length === 0) {
    return null;
  }
  return (
    <section className="f9-ads-sec" aria-labelledby="brand-capture-failures-title">
      <div className="f9-container">
        <div className="f9-ads-sec-head">
          <div className="f9-ads-sec-head-left">
            <span className="f9-ads-sec-eyebrow">Checks that did not become an alert</span>
            <h2 id="brand-capture-failures-title">What we checked, even when it didn’t alert</h2>
          </div>
          <span className="f9-ads-sec-meta">
            {`${failures.length} ${failures.length === 1 ? "check" : "checks"} on record`}
          </span>
        </div>
        <ul className="f9-quiet-list">
          {failures.map((failure) => {
            const reason = formatCaptureAttemptReasonLabel(failure.reasonCode);
            const suffix = failure.reasonCode ? ` (${failure.reasonCode})` : "";
            const where = failure.urlChecked ? ` · ${shortUrl(failure.urlChecked)}` : "";
            return (
              <li key={failure.id} className="f9-quiet-list-item">
                <span className="f9-quiet-list-copy">
                  {`${reason}${where}.${suffix} No alert sent.`}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="f9-wk-dim">
          Every check we ran is listed — including the ones that didn’t produce an
          alert, with the reason. A failed capture is never an alert, but it is never
          hidden either.
        </p>
      </div>
    </section>
  );
}

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host}${path}`;
  } catch {
    return url.length > 60 ? `${url.slice(0, 57)}…` : url;
  }
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
  // The wall always shows every cached creative; attribution analytics above
  // it speak only about the verified-linked subset (see the loader).
  const totalCount = data.ads.length;
  const adWord = totalCount === 1 ? "ad" : "ads";
  const watchLabel = `Watch ${data.domain}`;
  const allBrandOwned = totalCount > 0 && data.brandOwnedAdCount === totalCount;
  // Headline ownership speaks about the verified-linked capture only.
  // Unverified wall matches must not flip the H1 into split "X of these Y"
  // copy when every verified-linked creative is the brand's own.
  const allVerifiedBrandOwned =
    data.verifiedLinkCount > 0 && data.brandOwnedAdCount === data.verifiedLinkCount;
  const noneBrandOwned = data.brandOwnedAdCount === 0;
  // Mirror brandPageDescription: "other advertisers" in the closer split means
  // verified-from-other only, so the split sums to verifiedLinkCount and
  // unverified text-matches stay in their own labelled note.
  const otherCount = data.verifiedLinkCount - data.brandOwnedAdCount;

  return (
    <>
      {/* 1. HERO — the verdict + the score card */}
      <section className="f9-ads-hero" aria-labelledby="brand-ads-title">
        <div className="f9-container">
          <div className="f9-ads-hero-grid">
            <div className="f9-ads-hero-copy">
              <p className="f9-ads-eyebrow">
                <span aria-hidden="true" className="f9-ads-dot-live" />
                {`Tracking ${data.domain}`}
                {data.checkedAgo ? (
                  <>
                    <span className="f9-ads-eyebrow-sep" aria-hidden="true">·</span>
                    <span className="f9-ads-fresh-stamp">{`Last checked ${data.checkedAgo}`}</span>
                  </>
                ) : null}
              </p>
              <h1 className="f9-ads-headline" id="brand-ads-title">
                {brandHeadline(data, totalCount, adWord, allVerifiedBrandOwned, noneBrandOwned)}
              </h1>
              <p className="f9-ads-subline">
                {heroDetailSentence(data, teaser, data.freshForLiveClaim, allBrandOwned, noneBrandOwned, data.domain)}
                <b>Point us at your competitor and you'll never hear their next move from a client first.</b>
              </p>
            </div>

            <BrandScoreCard aggression={data.aggression} />
          </div>

          {/* 2. Primary CTA strip */}
          <div className="f9-ads-watch-strip">
            <div className="f9-ads-watch-copy">
              <h2>
                {"Watch "}
                <span className="f9-ads-watch-g">{data.domain}</span>
                {" — free"}
              </h2>
              <p>
                Create a free account and the first scan runs the moment you land. Every ad, offer,
                CTA and form change hits your inbox with the screenshot, the page text, and the link.
              </p>
            </div>
            <Link className="f9-ads-watch-btn" to={signupPath}>
              {`${watchLabel} →`}
            </Link>
          </div>
        </div>
      </section>

      {/* 3. STAT LINE — built only from verified-linked creatives (see loader) */}
      {teaser ? (
        <BrandStatLine
          ads={data.verifiedLinkedAds}
          aggression={data.aggression}
          freshnessLabel={data.checkedAgo}
          fresh={data.freshForLiveClaim}
          movesThisWeek={data.changeEvents.length}
          teaser={teaser}
        />
      ) : null}

      {/* 4. WHAT CHANGED THIS WEEK — only when real change events exist */}
      {data.changeEvents.length > 0 ? (
        <section className="f9-ads-sec" aria-labelledby="brand-changed-title">
          <div className="f9-container">
            <div className="f9-ads-sec-head">
              <div className="f9-ads-sec-head-left">
                <span className="f9-ads-sec-eyebrow">The reason to watch</span>
                <h2 id="brand-changed-title">What changed this week</h2>
              </div>
              <span className="f9-ads-sec-meta">
                {`${data.changeEvents.length} ${data.changeEvents.length === 1 ? "move" : "moves"} · each with a saved screenshot`}
              </span>
            </div>
            <BrandChangeTimeline events={data.changeEvents} />
          </div>
        </section>
      ) : null}

      <BrandOfferTimeline domain={data.domain} entries={data.offerTimelineEntries} />
      <BrandCaptureFailures failures={data.captureFailures} />

      {/* 5. THE ADS — the wall of real creatives */}
      <section className="f9-ads-sec" aria-labelledby="brand-wall-title">
        <div className="f9-container">
          <div className="f9-ads-sec-head">
            <div className="f9-ads-sec-head-left">
              <span className="f9-ads-sec-eyebrow">
                {data.freshForLiveClaim ? "Running right now" : "From the last check"}
              </span>
              <h2 id="brand-wall-title">{`All ${totalCount} ${adWord}, on the wall`}</h2>
            </div>
            <span className="f9-ads-sec-meta">
              {data.checkedAgo
                ? `real creatives from ${adLibrarySourcePhrase(data.adLibraryCountry)} · cached ${data.checkedAgo}`
                : `real creatives from ${adLibrarySourcePhrase(data.adLibraryCountry)}`}
            </span>
          </div>
          <BrandAdWall
            ads={data.ads}
            domain={data.domain}
            fresh={data.freshForLiveClaim}
            signupPath={signupPath}
            totalCount={totalCount}
          />
        </div>
      </section>

      {/* 6. CLOSER */}
      <section className="f9-ads-closer">
        <div className="f9-container">
          <h2 className="f9-ads-closer-head">
            {closerHeadline(data, allBrandOwned, noneBrandOwned)}
            <span className="f9-ads-hl">Be the first to know.</span>
          </h2>
          <div className="f9-ads-closer-cta">
            <Link className="f9-ads-watch-btn" to={signupPath}>
              {`${watchLabel} →`}
            </Link>
            <Link className="f9-ads-ghost" to={liveSearchPath}>
              or run a live search first ›
            </Link>
          </div>
          <p className="f9-ads-honest">
            {closerHonestyLine(data, allBrandOwned, noneBrandOwned, otherCount)}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </p>
        </div>
      </section>
    </>
  );
}

/**
 * The H1 verdict. "{Brand} is running N Meta ads" is an ownership claim —
 * it only applies when every verified-linked creative is the brand's own.
 * Unverified wall matches are named in the subline, never folded into split
 * "X of these Y" copy. "Pointing at {domain}" is a link claim — it only
 * applies when the capture carries verified link evidence. Creatives that
 * merely match the search (text-mention / provider candidates) are
 * "matching {domain}", never "pointing at" it.
 *
 * This must return a plain string: the page <h1> is the document topic
 * heading and must not contain nested markup.
 */
function brandHeadline(
  data: BrandPageLoaderData,
  totalCount: number,
  adWord: string,
  allBrandOwned: boolean,
  noneBrandOwned: boolean,
): string {
  // No verified link evidence: the wall is real creatives matching the search.
  // The page must not claim they point at, link to, or run for the domain.
  if (data.verifiedLinkCount === 0) {
    const matchPhrase = `${totalCount} Meta ${adWord}`;
    return data.freshForLiveClaim
      ? `${matchPhrase} ${totalCount === 1 ? "is" : "are"} matching ${data.domain} right now.`
      : `The last check found ${matchPhrase} matching ${data.domain}.`;
  }

  // Verified link evidence exists — speak about the verified capture only;
  // unverified matches get their own honest line in the subline.
  const verifiedAdWord = data.verifiedLinkCount === 1 ? "ad" : "ads";
  const verifiedPhrase = `${data.verifiedLinkCount} Meta ${verifiedAdWord}`;
  if (allBrandOwned) {
    return data.freshForLiveClaim
      ? `${data.brandName} is running ${verifiedPhrase} right now.`
      : `${data.brandName} was running ${verifiedPhrase} at the last check.`;
  }

  if (noneBrandOwned) {
    return data.freshForLiveClaim
      ? `${verifiedPhrase} ${data.verifiedLinkCount === 1 ? "is" : "are"} pointing at ${data.domain} right now.`
      : `The last check found ${verifiedPhrase} pointing at ${data.domain}.`;
  }

  const splitPhrase = `${data.brandOwnedAdCount} of these ${verifiedPhrase}`;
  return data.freshForLiveClaim
    ? `${data.brandName} is running ${splitPhrase} right now.`
    : `${data.brandName} was running ${splitPhrase} at the last check.`;
}

/**
 * Real-data lead-in to the promise; drops clauses whose data is missing.
 * Present tense is a live claim — kept only while the capture is fresh. The
 * "they" of the brand is only safe when the creatives are the brand's own;
 * other-advertiser captures attribute the texture to the advertisers instead.
 * "Linking to" is used only for the verified-linked capture; unverified
 * matches are described as matching the search, with their unproven link
 * called out in the same breath.
 */
function heroDetailSentence(
  data: BrandPageLoaderData,
  teaser: BrandIntelTeaser | null,
  fresh: boolean,
  allBrandOwned: boolean,
  noneBrandOwned: boolean,
  domain: string,
): string {
  const sentence = heroDetailBase(
    teaser,
    fresh,
    allBrandOwned,
    noneBrandOwned,
    domain,
    data.verifiedLinkCount,
  );
  if (data.unverifiedMatchCount > 0) {
    const word = data.unverifiedMatchCount === 1 ? "ad" : "ads";
    if (data.verifiedLinkCount === 0) {
      return `${sentence}These matched the search for ${domain} — their link to the site is not verified. `;
    }
    return `${sentence}Another ${data.unverifiedMatchCount} ${word} matched the search without a verified link to ${domain}. `;
  }
  return sentence;
}

function heroDetailBase(
  teaser: BrandIntelTeaser | null,
  fresh: boolean,
  allBrandOwned: boolean,
  noneBrandOwned: boolean,
  domain: string,
  verifiedLinkCount: number,
): string {
  if (!teaser) return "";
  const parts: string[] = [];
  if (teaser.formats.length > 1) {
    parts.push(`across ${teaser.formats.length} formats`);
  }
  if (teaser.longestRunningDays !== null) {
    parts.push(
      `with one ad live for ${teaser.longestRunningDays} ${teaser.longestRunningDays === 1 ? "day" : "days"}`,
    );
  }

  if (allBrandOwned) {
    if (parts.length === 0) {
      return fresh
        ? "They're advertising while your team is offline. "
        : "They were advertising at the last check. ";
    }
    return fresh
      ? `They're testing ${parts.join(" and ")}. `
      : `At the last check they were testing ${parts.join(" and ")}. `;
  }

  if (noneBrandOwned) {
    // No verified link evidence: these creatives merely match the search —
    // "linking to" would overclaim the connection.
    const linkPhrase =
      verifiedLinkCount === 0 ? "ads matching" : "ads that link to";
    if (parts.length === 0) {
      return fresh
        ? `Other advertisers are running ${linkPhrase} ${domain}. `
        : `At the last check, other advertisers were running ${linkPhrase} ${domain}. `;
    }
    const testingPhrase =
      verifiedLinkCount === 0 ? "on ads matching" : "on ads linking to";
    return fresh
      ? `Other advertisers are testing ${parts.join(" and ")} ${testingPhrase} ${domain}. `
      : `At the last check, other advertisers were testing ${parts.join(" and ")} ${testingPhrase} ${domain}. `;
  }

  // Mixed ownership: the headline already states the split — no extra claim.
  return "";
}

/** The closer headline — attributes the future move honestly by ownership. */
function closerHeadline(
  data: BrandPageLoaderData,
  allBrandOwned: boolean,
  noneBrandOwned: boolean,
): string {
  if (data.verifiedLinkCount === 0) {
    return `The advertisers running ads matching ${data.domain} will change their next ad. `;
  }
  if (allBrandOwned) {
    return `${data.brandName} will change their next ad. `;
  }
  if (noneBrandOwned) {
    return `The advertisers linking to ${data.domain} will change their next ad. `;
  }
  return `${data.brandName} and the other advertisers linking to ${data.domain} will change their next ad. `;
}

/** The closer honesty line — never claims the brand owns creatives it does not. */
function closerHonestyLine(
  data: BrandPageLoaderData,
  allBrandOwned: boolean,
  noneBrandOwned: boolean,
  otherCount: number,
): string {
  const cached = data.checkedAgo ? `, cached ${data.checkedAgo}` : "";
  const source = publicAdLibrarySourcePhrase(data.adLibraryCountry);
  const tail =
    " This page never runs a live scrape — a live search refreshes it. Coverage and freshness are labeled and vary by source. The Ad Aggression Score is computed from a public formula. ";

  const unverifiedNote =
    data.unverifiedMatchCount > 0
      ? ` Another ${data.unverifiedMatchCount} ${data.unverifiedMatchCount === 1 ? "ad" : "ads"} matched the search for ${data.domain} without a verified link.`
      : "";

  if (data.verifiedLinkCount === 0) {
    return `Ad creatives are real Meta Ad Library ads that matched the search for ${data.domain}${cached}. Their link to the site is not verified.${tail}`;
  }
  if (allBrandOwned) {
    return `Ad creatives are ${data.brandName}'s real ads from ${source}${cached}.${tail}${unverifiedNote}`;
  }
  if (noneBrandOwned) {
    return `Ad creatives are real ads from ${source}, run by other advertisers linking to ${data.domain}${cached}.${tail}${unverifiedNote}`;
  }
  // Drop the "and Y by other advertisers" clause when there are no
  // verified-from-other creatives — unverified matches live in unverifiedNote.
  const otherClause = otherCount > 0 ? ` and ${otherCount} by other advertisers` : "";
  return `Ad creatives are real ads from ${source} linking to ${data.domain}${cached} — ${data.brandOwnedAdCount} run by ${data.brandName}${otherClause}.${tail}${unverifiedNote}`;
}

/**
 * Cache-miss / no-cache teaching shell (per intent audit SF-3): the same
 * poster system with a clearly-labeled EXAMPLE preview — never a dotted
 * apology. Always noindexed by the loader.
 *
 * NOTE (issue #1282): the loader now 301-redirects to /search?q=<domain>
 * when there is no usable cache snapshot, so this shell is no longer
 * reachable via a live request. It is retained for the component-level
 * render tests and as a fallback if the redirect is ever reverted.
 */
function BrandAdsShell({
  data,
  liveSearchPath,
  signupPath,
}: {
  data: BrandPageLoaderData;
  liveSearchPath: string;
  signupPath: string;
}) {
  const exampleAggression: BrandPageAggression = {
    score: 72,
    components: { velocity: 20, testing: 18, freshness: 19, persistence: 15 },
    bandId: "aggressive",
    bandLabel: "Aggressive",
    bandInterpretation: "Running an aggressive testing program.",
    formulaVersion: 1,
    windowDays: 21,
    adsPerWeek: 5,
    adCount: 24,
    activeCount: 21,
  };
  const exampleEvents: BrandChangeEvent[] = [
    {
      id: "example-1",
      dayLabel: "Today",
      isToday: true,
      source: "AD LIBRARY",
      move: "New ad entered rotation — a fresh summer creative",
      why: "Launched with 3 variants — they're testing which creative wins.",
      variantCount: 3,
    },
  ];

  return (
    <section className="f9-ads-shell" aria-labelledby="brand-ads-title">
      <div className="f9-container">
        <p className="f9-ads-eyebrow">
          <span aria-hidden="true" className="f9-ads-dot-live f9-ads-dot-quiet" />
          {`Not watching ${data.domain} yet`}
        </p>
        <h1 className="f9-ads-headline f9-ads-shell-head" id="brand-ads-title">
          {`We haven't watched ${data.domain} yet — here's what you'd wake up to.`}
        </h1>
        <p className="f9-ads-subline">
          Run a free live search and we'll pull their Meta ads right now. Then start watching, and
          every change lands in your inbox with the screenshot, the page text, and the link.
        </p>

        <div className="f9-ads-shell-cta">
          <Link className="f9-ads-watch-btn" to={liveSearchPath}>
            Run a free live search →
          </Link>
          <Link className="f9-ads-ghost" to={signupPath}>
            {`or watch ${data.domain} ›`}
          </Link>
        </div>

        <BrandOfferTimeline domain={data.domain} entries={data.offerTimelineEntries} />
        <BrandCaptureFailures failures={data.captureFailures} />

        <div className="f9-ads-example" aria-hidden="true">
          <span className="f9-ads-example-tag">Example — this is what a watched brand looks like</span>
          <div className="f9-ads-example-grid">
            <BrandScoreCard aggression={exampleAggression} />
            <div className="f9-ads-example-side">
              <BrandChangeTimeline events={exampleEvents} example />
              <div className="f9-ads-example-cards">
                <article className="f9-ads-card">
                  <AdCreative
                    ad={{
                      advertiser: data.brandName,
                      format: "image",
                      previewHeadline: "Your competitor's headline, saved to the pixel.",
                      hook: "Shop Now",
                      creativeImageUrl: null,
                    }}
                    savedLabel="Example"
                  />
                </article>
                <article className="f9-ads-card">
                  <AdCreative
                    ad={{
                      advertiser: data.brandName,
                      format: "video",
                      previewHeadline: "Every video creative, poster frame and all.",
                      hook: "Watch",
                      creativeImageUrl: null,
                    }}
                    savedLabel="Example"
                  />
                </article>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
