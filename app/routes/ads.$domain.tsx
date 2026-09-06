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
 *   - a capture with ZERO verified-linked ads — the page's named
 *     differentiator (the Ad Aggression Score) cannot render for a wall of
 *     unverified text-mention matches, so the page would ship as indexable
 *     thin content. The wall still renders for a direct visitor; only
 *     indexability is withheld.
 *
 * A populated page (at least one verified-linked ad) with a fresh snapshot
 * is indexable EVEN when the Ad Aggression Score is deferred (the observed
 * window is shorter than the 14-day floor, or no ad carries a first-seen
 * date): the page is not thin — it has a real ad wall, verified counts, a
 * teaser, and a change feed. Indexability is decoupled from score
 * computability (issue #1442); the score card renders an honest
 * "N/14 days so far" state instead of suppressing the page. Only the
 * genuinely thin case (0 verified-linked ads) withholds indexability.
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
import { useState } from "react";

import { AdCreative } from "~/components/ads/ad-creative";
import { BrandAdWall } from "~/components/ads/brand-ad-wall";
import { BrandChangeTimeline } from "~/components/ads/brand-change-timeline";
import { BrandScoreCard } from "~/components/ads/brand-score-card";
import { BrandStatLine } from "~/components/ads/brand-stat-line";
import { BrandTicker } from "~/components/ads/brand-ticker";
import { BrowseTrackedCompetitors } from "~/components/ads-internal-links";
import { MarketingFooter } from "~/components/marketing-footer";
import { MarketingNav } from "~/components/marketing-nav";
import { OfferTimelineLedger } from "~/components/offer-timeline-ledger";
import { getOptionalCloudflareContext } from "~/lib/cloudflare-context";
import { CAPTURE_RULES_PUBLIC_PATH } from "~/lib/capture-validity-public-rules";
import { AD_AGGRESSION_METHODOLOGY_PATH } from "~/lib/aggression-score";
import type { IndexableAdsLink } from "~/lib/ads-internal-links";
import type {
  BrandChangeEvent,
  BrandIntelTeaser,
  BrandPageAggression,
} from "~/lib/brand-page.server";
import { brandOwnedAdIdSet } from "~/lib/brand-page.server";
import type { OfferLedgerEntry } from "~/lib/offer-timeline";
import type { CaptureFailuresSummary } from "~/lib/offer-timeline.server";
import { formatCaptureAttemptReasonLabel } from "~/lib/capture-attempt-reason-code";
import type { CaptureAttemptReasonCode } from "~/lib/capture-attempt-reason-code";
import {
  adsPageServiceJsonLd,
  adsSocialCardUrl,
  brandPageTimelineHasPart,
  breadcrumbListJsonLd,
  canonicalUrl,
  faqPageJsonLd,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
} from "~/lib/seo";
import type { BreadcrumbJsonLdItem, FaqJsonLdEntry } from "~/lib/seo";
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
  /**
   * metaAdIds of the verified-linked creatives that are NOT the brand's own —
   * partner, creator, reseller, or affiliate campaigns that link to the domain
   * under a different advertiser (a different Meta Page ID). The ad wall labels
   * these with a "via partner" pill so a buyer can see the disambiguation
   * (issue #1566).
   */
  partnerCampaignAdIds: string[];
  teaser: BrandIntelTeaser | null;
  aggression: BrandPageAggression | null;
  /**
   * Observation window (whole days) between the oldest verified-linked ad's
   * first-seen date and now, for the score card's honest "N/14 days so far"
   * state when the Ad Aggression Score is still deferred (window below the
   * MIN_AGGRESSION_WINDOW_DAYS floor). Null when no verified-linked ad
   * carries a first-seen date (window not computable) — the card degrades to
   * the generic "not enough history" note. Never a signal for indexability
   * (issue #1442).
   */
  observationDays: number | null;
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
  /**
   * Other indexable /ads/:domain pages this page cross-links to (issue
   * #1417). The sitemap's /ads pages were orphans — they linked to /compare,
   * /switch, /search, /pricing and /competitor-monitoring but never to each
   * other, so Google discovered them only via the sitemap with no internal
   * link equity flowing between brand pages. This deterministic set of up to
   * four OTHER indexable brand pages (the current domain always excluded,
   * see pickRelatedBrandLinks) restores the cross-links. Empty on a cache
   * hiccup or a single-brand sitemap — the section hides in that case. The
   * `BrowseTrackedCompetitors` component renders these, always backed by a
   * link to the /brands hub so every brand page also reaches the full list.
   */
  relatedBrands: IndexableAdsLink[];
  noindex: boolean;
  canonicalPath: string;
  /**
   * Server-rendered summary of recent landing-page captures for this domain
   * that did NOT produce an alert — failed or skipped checks with a public
   * reason code (issues #1289, #1345). The full per-entry list is NOT leaked
   * into the loader data; it is lazy-loaded on expand via the
   * `api.ads.capture-failures.$domain` endpoint. Null when nothing is stored
   * (the section hides in that case).
   */
  captureFailuresSummary: CaptureFailuresSummary | null;
}

export async function loader({ context, params, request }: LoaderFunctionArgs): Promise<BrandPageLoaderData> {
  const { normalizeBrandPageDomain } = await import("~/lib/brand-page.server");
  const brand = normalizeBrandPageDomain(params.domain);
  if (!brand) {
    throw new Response("Not Found", { status: 404 });
  }

  const { getEnv } = await import("~/lib/context.server");
  let env = getEnv(context);
  const cloudflare = getOptionalCloudflareContext(context);

  // Local release proofs use isolated D1 fixtures; mirror the /search route's
  // E2E env resolution so brand pages can serve them without live providers.
  const { resolveE2ELocalSearchEnv } = await import("~/lib/e2e-search.server");
  env = await resolveE2ELocalSearchEnv(env, request);

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
    brandPageObservationWindowDays,
    buildBrandChangeFeed,
    buildBrandIntelTeaser,
    computeBrandPageAggressionScore,
    loadBrandPageCacheSnapshot,
    resolveBrandPageFreshness,
    resolveCanonicalBrandPageDomain,
  } = await import("~/lib/brand-page.server");
  const { defaultCountryForVisitor } = await import("~/lib/countries");
  const { loadOfferTimeline } = await import("~/lib/offer-timeline.server");
  const visitorCountry = defaultCountryForVisitor(
    cloudflare?.country ??
      request.headers.get("cf-ipcountry"),
  );

  let snapshot: Awaited<ReturnType<typeof loadBrandPageCacheSnapshot>> = null;

  // Issue #1446 — an alias brand page (the natural base domain a buyer types,
  // e.g. ridge.com / oura.com) must not compete with its populated product
  // page for the same brand's ads and link equity. When the canonical (product)
  // page is actually populated, 301 the alias onto it (consolidating sitemap
  // and link equity); when it is NOT populated we fall through and render the
  // alias normally — the anti-thin-content guard keeps a weak alias page
  // noindex, and we never redirect to an empty target (criterion 4).
  const canonicalResolution = resolveCanonicalBrandPageDomain(brand.domain);
  if (canonicalResolution.isAlias && canonicalResolution.canonical !== brand.domain) {
    let canonicalSnapshot: Awaited<ReturnType<typeof loadBrandPageCacheSnapshot>> = null;
    try {
      canonicalSnapshot = await loadBrandPageCacheSnapshot(env, {
        domain: canonicalResolution.canonical,
        visitorCountry,
      });
    } catch (error) {
      // A canonical-alias cache-read hiccup must degrade to the normal alias
      // render path, never a 500 and never a live-provider fallback.
      console.warn("Brand page canonical alias cache read failed; falling through.", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
    if (canonicalSnapshot) {
      throw redirect(`/ads/${encodeURIComponent(canonicalResolution.canonical)}`, 301);
    }
  }

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
  //   - thin content (0 verified-linked ads — the Ad Aggression Score cannot
  //     render, so the wall ships without the page's differentiator).
  // A populated page (≥1 verified-linked ad) with a fresh snapshot stays
  // indexable even when the score is deferred (sub-14-day window) — issue
  // #1442 decouples indexability from score computability.
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

  // Issues #1289 / #1345: surface failed/suppressed landing-page captures
  // for this domain so the public page names what we checked and why it did
  // not become an alert. The full array is NOT leaked into the loader data —
  // only a server-rendered summary (count, date range, reason) ships to the
  // client. The per-entry list is lazy-loaded on expand via the
  // `api.ads.capture-failures.$domain` endpoint. Bounded D1 read; degrades
  // to null on any failure.
  const { loadDomainCaptureFailures, summarizeDomainCaptureFailures } = await import(
    "~/lib/offer-timeline.server"
  );
  const captureFailures = await loadDomainCaptureFailures(env, { domain: brand.domain });
  const captureFailuresSummary = summarizeDomainCaptureFailures(captureFailures);

  const now = new Date();
  const freshness = snapshot
    ? resolveBrandPageFreshness(snapshot.fetchedAt, now)
    : null;
  const emergencyNoindex = env.PUBLIC_BRAND_PAGES_INDEXABLE?.trim() === "0";

  // Issue #1417: the sitemap's /ads/:domain pages were orphaned — none
  // linked to another /ads page, so a buyer landing on /ads/nike.com could
  // not discover /ads/adidas.com without going back to search, and Google
  // saw no internal link equity flowing between brand pages. Load the other
  // indexable brand-page links (the same sitemap indexability signal) and
  // pick this page's deterministic "Related brands" set. Cache-only: one
  // bounded D1 read; a hiccup degrades to [] (the section hides) rather
  // than 500ing the brand page or triggering any paid operation.
  let relatedBrands: IndexableAdsLink[] = [];
  try {
    const { loadIndexableAdsInternalLinks } = await import("~/lib/ads-internal-links.server");
    const { pickRelatedBrandLinks } = await import("~/lib/ads-internal-links");
    const allLinks = await loadIndexableAdsInternalLinks(env);
    relatedBrands = pickRelatedBrandLinks(allLinks, brand.domain);
  } catch (error) {
    console.warn("Brand page related-brands load failed; omitting cross-links.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    relatedBrands = [];
  }

  // Attribution analytics (score, teaser, change feed, ownership) derive ONLY
  // from creatives with verified link evidence. Ads the provider returned as
  // text-mention / provider candidates may be real creatives, but they are not
  // the searched brand's ads — no score or "what changed" may be built on
  // them. They still render on the wall, labeled as matching the search.
  const snapshotAds = snapshot?.ads ?? [];
  const verifiedLinkedAds = snapshot
    ? snapshotAds.filter((ad) => adHasVerifiedDomainLink(ad, brand.domain))
    : [];

  // The wall needs every record to carry its OWN verified signal (accept:
  // "consume the distinction via the existing AdRecord shape — do not pass
  // booleans by prop drilling"). Annotate a wall copy so BrandAdCard can show
  // a glanceable "Verified link" badge and order verified cards first, while
  // the original snapshot records the score and change feed derive from stay
  // pristine (their shape is unchanged, only the enriched copy is passed to
  // the wall).
  const verifiedLinkedIds = new Set(verifiedLinkedAds.map((a) => a.metaAdId));
  const wallAds = snapshotAds.map((ad) =>
    verifiedLinkedIds.has(ad.metaAdId)
      ? { ...ad, linkVerifiedDomain: brand.domain }
      : ad,
  );

  // The Ad Aggression Score (0–100, four public sub-scores) is the page's
  // named differentiator (category-research §1.2). It renders ONLY when the
  // capture has at least one verified-linked ad AND the observed window
  // clears the 14-day floor — `computeBrandPageAggressionScore` returns null
  // otherwise (0 verified-linked ads, no first-seen date, or a window shorter
  // than MIN_AGGRESSION_WINDOW_DAYS). Below the floor the score card renders
  // an honest "N/14 days so far" state, but indexability is NOT gated on the
  // score: a populated page (≥1 verified-linked ad, fresh snapshot) is
  // indexable even when the score is deferred. Only the genuinely thin case
  // — a wall with ZERO verified-linked ads — self-noindexes, so no indexable
  // thin brand page remains in the sitemap (issue #1442).
  const aggression = snapshot ? computeBrandPageAggressionScore(verifiedLinkedAds, now) : null;
  // Indexability is a content-thinness rule, not a score rule: a populated
  // page with real verified-linked ads is indexable regardless of whether
  // the score can render. The 14-day window previously forced every
  // newly-discovered populated brand invisible to Google for two weeks
  // (issue #1442) — decouple them. `!snapshot` is defensive (the loader
  // already redirects on a true cache miss above).
  const noindex =
    emergencyNoindex || !snapshot || !snapshot.freshForIndexing || verifiedLinkedAds.length === 0;

  const brandOwnedSet = brandOwnedAdIdSet(verifiedLinkedAds, brand.domain);

  return {
    domain: brand.domain,
    brandName: brand.displayName,
    hasCachedAds: Boolean(snapshot),
    ads: wallAds,
    verifiedLinkedAds,
    checkedAgo: freshness?.checkedAgo ?? null,
    lastCheckedAt: snapshot?.fetchedAt ?? null,
    freshForLiveClaim: freshness?.freshForLiveClaim ?? false,
    brandOwnedAdCount: brandOwnedSet.size,
    verifiedLinkCount: verifiedLinkedAds.length,
    unverifiedMatchCount: snapshotAds.length - verifiedLinkedAds.length,
    partnerCampaignAdIds: verifiedLinkedAds
      .filter((ad) => !brandOwnedSet.has(ad.metaAdId))
      .map((ad) => ad.metaAdId),
    teaser: snapshot ? buildBrandIntelTeaser(verifiedLinkedAds, now) : null,
    aggression,
    // Honest "N/14 days so far" for the score card when the score is
    // deferred; NOT an indexability signal (issue #1442).
    observationDays: snapshot
      ? brandPageObservationWindowDays(verifiedLinkedAds, now)
      : null,
    changeEvents: snapshot ? buildBrandChangeFeed(verifiedLinkedAds, now) : [],
    offerTimelineEntries,
    adLibraryCountry: snapshot ? brandPageAdLibraryCountryLabel(snapshot.country) : null,
    noindex,
    relatedBrands,
    canonicalPath: `/ads/${brand.domain}`,
    captureFailuresSummary,
  };
}

/**
 * Single source of truth for the page title — shared by the <title>/og:title
 * meta and the WebPage JSON-LD `name` so structured data always states exactly
 * what the visible page states.
 *
 * The title is deliberately TIME-STABLE: it must never embed the per-request
 * freshness stamp ("checked about N…", the live-scrape "right now" claim).
 * That stamp churns the document identity Google indexes for the programmatic
 * /ads/:domain surface on every crawl, signals instability, and reads as a
 * tool tell in the SERP. The freshness lives in the visible page captions and
 * the meta description (which carry their own honesty gate for the "right
 * now" claim) — never in the title.
 */
export function brandPageTitle(data: BrandPageLoaderData): string {
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
  return `${subject} | Five to Nine`;
}

/**
 * Honest Ad Library source phrase for page copy, from the snapshot country:
 * "the India Ad Library" for a named country, "Meta's global ad library"
 * for the all-countries view. The Meta Ad Library is country-scoped, so
 * this always names the library the cached creatives actually came from
 * (the loader geo-defaults the lookup — the copy must not). The
 * all-countries value is a single `country=ALL` query, not a union of
 * every market, so the copy names the global library in plain buyer
 * language without claiming worldwide coverage ("across all countries"
 * stays banned here, issue #1464). The fallback never renders for a
 * populated page; it exists only to keep the copy grammatical if a
 * snapshot ever lacks a country.
 */
export function adLibrarySourcePhrase(adLibraryCountry: string | null): string {
  if (adLibraryCountry && adLibraryCountry !== "all countries") {
    return `the ${adLibraryCountry} Ad Library`;
  }
  return "Meta's global ad library";
}

/**
 * The same source phrase with the "public" qualifier used by the closer
 * honesty line: "the public India Ad Library" / "Meta's public global ad
 * library".
 */
export function publicAdLibrarySourcePhrase(adLibraryCountry: string | null): string {
  if (adLibraryCountry && adLibraryCountry !== "all countries") {
    return `the public ${adLibraryCountry} Ad Library`;
  }
  return "Meta's public global ad library";
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
  if (data.brandOwnedAdCount === 0 && !data.aggression) {
    // The ads link to the domain but none could be attributed to the brand
    // itself (no verified advertiser-domain/entity level, and the advertiser
    // page name does not match the brand). The page must not frame them as
    // "from other advertisers" — that disclaims the page's own subject on the
    // indexed surface. Say explicitly that ownership could not be verified
    // from the cached capture, keeping the brand as the subject (issue #1428).
    // The deny-proof sentence is legal ONLY in this state: the page renders
    // no Aggression Score card here. A rendered score card is itself proof
    // the capture carries a verified link (its own FAQ says so), so saying
    // "could not verify" next to it would contradict the page (issue #1447).
    return `See ${data.verifiedLinkCount} Meta ${linkWord} linking to ${data.domain}, from ${check}. We could not verify from the cached capture that ${data.brandName} runs these ads. Get an email when the ads or offers change.${unverifiedTail}`;
  }
  if (data.brandOwnedAdCount === 0) {
    // Verified link evidence exists and the Aggression Score card renders.
    // The description must not deny verification the page proves, and must
    // not claim the brand runs ads the attribution could not assign to it:
    // the verified copy keeps the brand as the subject and says the ads
    // link to the domain (issue #1447).
    return `See ${data.verifiedLinkCount} Meta ${linkWord} linking to ${data.domain}, from ${check}. Get an email when the ads or offers change.${unverifiedTail}`;
  }
  // When every verified linking creative is the brand's own (no
  // verified-from-other), drop the "and Y from other advertisers" clause —
  // the unverified matches appear only in the tail.
  const otherClause =
    otherCount > 0 ? ` and ${otherCount} from other advertisers` : "";
  return `See ${data.verifiedLinkCount} Meta ${linkWord} linking to ${data.domain} — ${data.brandOwnedAdCount} from ${data.brandName}${otherClause} — from ${check}. Get an email when the ads or offers change.${unverifiedTail}`;
}

/**
 * Brand-specific FAQ for the /ads/:domain page. Rendered on the page AND
 * emitted as FAQPage JSON-LD from this same array, so the structured data can
 * never drift from the visible copy. Every answer is grounded in content the
 * page already shows: the Ad Aggression Score card (public formula at
 * /ad-aggression, four sub-scores Velocity/Testing/
 * Freshness/Persistence), the visible "Last checked …" stamp and the
 * scheduled-scan cadence (Scout every 6h, Starter/Agency every 3h), the
 * verified-link vs matching-only distinction the page already labels, and
 * the "Watch {domain}" CTA. The brand name and domain are interpolated from
 * the loader so each /ads/:domain page ships its own brand-specific FAQ.
 *
 * Returns null when the page has no cached ads or no verified-link evidence
 * — the FAQ is grounded in on-page content that only exists for a real,
 * verified capture, so a cache-miss shell (which 301-redirects anyway) or a
 * page of unverified text-mention matches never ships one.
 */
export function brandPageFaqEntries(data: BrandPageLoaderData): ReadonlyArray<FaqJsonLdEntry> | null {
  if (!data.hasCachedAds || data.verifiedLinkCount === 0) {
    return null;
  }
  const { brandName, domain } = data;
  const checkedPhrase = data.checkedAgo
    ? `The page's "Last checked ${data.checkedAgo}" stamp is the most recent one.`
    : "The most recent check is stamped on the page.";
  return [
    {
      question: `How is ${brandName}'s Ad Aggression Score calculated?`,
      answer: `The Ad Aggression Score is a 0–100 number from a public formula at ${AD_AGGRESSION_METHODOLOGY_PATH}. It is the sum of four sub-scores, 0–25 each — Velocity (new ads per week), Testing (share of ads with more than one creative variant), Freshness (how recent the creatives are), and Persistence (how long ads stay live). They add up to the score with no hidden weighting, and the score card on this page shows each one. The score only renders once ${brandName} has at least 14 days of watching and at least one ad with a verified link to ${domain}.`,
    },
    {
      question: `How often are ${brandName}'s ads checked?`,
      answer: `${checkedPhrase} Five to Nine runs scheduled checks of the public Meta Ad Library on a plan cadence: Scout every 6 hours, Starter every 3 hours, and Agency every 3 hours for its first 25 watchlists with the rest every 6 hours. Starter and Agency can also turn on instant alerts. This page shows the result of the most recent scheduled check, cached — it never runs a live scrape on a public visit.`,
    },
    {
      question: `What does "verified" mean on these ads?`,
      answer: `An ad is labeled as linking to ${domain} only when it carries verified link evidence — the ad's landing page or advertiser domain actually matches ${domain}. Ads the provider returned that merely match the search text, without a verified link, are still shown on the wall but are described as "matching the search", never as linking to or running for ${brandName}. The Ad Aggression Score and the "what changed" feed are built only from the verified-link subset, so attribution never rests on an unproven connection.`,
    },
    {
      question: `Can I get an email when ${brandName}'s ads or offer change?`,
      answer: `Yes. The "Watch ${domain} — free" button on this page starts a free account, and the first scan runs the moment you land. After that, every ad, offer, CTA, and form change hits your inbox with a screenshot when the capture includes one, the page text, and the source link. Quiet periods still send a heartbeat so silence always means we looked.`,
    },
  ];
}

/**
 * The breadcrumb trail for the /ads/:domain page, shared by the visible
 * breadcrumb nav and the BreadcrumbList JSON-LD so the two can never drift
 * (issue #1418). Three levels: Home (Five to Nine), the Ads parent, and the
 * current brand page.
 *
 * The middle "Ads" entry links to /search — there is no /ads index page and
 * no /brands hub yet (issue #1417 covers building one). When #1417 lands a
 * /brands hub, this one line is the only change needed: swap "/search" for
 * "/brands" and the visible nav + JSON-LD both follow.
 *
 * Returns null on the cache-miss shell (which 301-redirects and never
 * reaches the render) — the breadcrumb is grounded in a real brand page that
 * the visitor is actually on.
 */
export function brandPageBreadcrumbItems(
  data: BrandPageLoaderData,
): ReadonlyArray<BreadcrumbJsonLdItem> | null {
  if (!data.hasCachedAds) {
    return null;
  }
  return [
    { name: "Five to Nine", pathname: "/" },
    { name: "Ads", pathname: "/search" },
    { name: data.brandName, pathname: data.canonicalPath },
  ];
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
  const score = loaderData.aggression?.score ?? null;
  const ogImageUrl = adsSocialCardUrl(loaderData.domain, loaderData.brandName, score);
  const ogImageAlt =
    score !== null
      ? `${loaderData.brandName} Meta ads — Ad Aggression Score ${score} — Five to Nine`
      : `${loaderData.brandName} Meta ads — Five to Nine`;

  return [
    ...publicSeoMeta({
      title,
      description,
      pathname: loaderData.canonicalPath,
      ogImageUrl,
      ogImageAlt,
    }),
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

  const faqEntries = brandPageFaqEntries(data);

  return (
    <main className="f9-home f9-ads-page">
      {/*
       * Truthful WebPage + Service + FAQPage + BreadcrumbList JSON-LD, and
       * ONLY on indexable pages: the honest shell, demo-sourced entries,
       * stale (> 7 days) captures, and the emergency-brake flag all carry
       * noindex — structured data on those states would be dead weight at
       * best and a freshness lie at worst. Every field mirrors the visible
       * page: the meta title/description, the canonical URL, the on-screen
       * "Last checked" stamp (dateModified), the brand the page is about,
       * the Watch {domain} offer with Five to Nine as the provider, the
       * breadcrumb trail rendered as the visible nav (issue #1418), and the
       * brand-specific FAQ rendered from the same array further down the
       * page.
       */}
      {!data.noindex ? (
        <>
          {(() => {
            const breadcrumbItems = brandPageBreadcrumbItems(data);
            if (!breadcrumbItems) return null;
            return (
              <script {...jsonLdScriptProps(breadcrumbListJsonLd(breadcrumbItems))} />
            );
          })()}
          <script
            {...jsonLdScriptProps(
              webPageJsonLd({
                name: brandPageTitle(data),
                description: brandPageDescription(data),
                pathname: data.canonicalPath,
                dateModified: data.lastCheckedAt ?? undefined,
                aboutName: data.brandName,
                // Issue 964: link this brand page to its citable Offer
                // Timeline Dataset so answer engines can follow the
                // relationship from the brand page to the change-ledger.
                // Only when a stored timeline exists — the page links the
                // timeline section in exactly that case, and a missing
                // timeline would point hasPart at a 410 Gone URL.
                hasPart:
                  data.offerTimelineEntries.length > 0
                    ? brandPageTimelineHasPart({
                        domain: data.domain,
                        brandName: data.brandName,
                      })
                    : undefined,
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
          {faqEntries ? (
            <script {...jsonLdScriptProps(faqPageJsonLd(faqEntries))} />
          ) : null}
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
 * stored (never an empty card). Proof-less backfill rows are filtered out by
 * loadOfferTimeline (issue #1284) so only states with both a stored screenshot
 * and page-text extract ever reach this surface.
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
 * Capture-failure visibility on the public `/ads/:domain` page (issues
 * #1289, #1345). Renders a server-rendered summary of recent landing-page
 * checks that did NOT produce an alert — failed or skipped captures with a
 * public reason — so a buyer can see what was checked and why the silence
 * is real. The full per-entry list is NOT in the loader data; it is
 * lazy-loaded on expand via the `api.ads.capture-failures.$domain` endpoint.
 * Hidden when nothing is stored (never an empty card).
 */
function BrandCaptureFailures({
  summary,
  domain,
  signupPath,
}: {
  summary: CaptureFailuresSummary | null;
  domain: string;
  signupPath: string;
}) {
  if (!summary) {
    return null;
  }
  const reasonLabel = formatCaptureAttemptReasonLabel(summary.reasonCode);
  const latestLabel = formatSkipDate(summary.latestDate);
  const rangeLabel = summary.earliestDate
    ? `between ${formatSkipDate(summary.earliestDate)} and ${latestLabel}`
    : `on ${latestLabel}`;
  const countWord = summary.count === 1 ? "check" : "checks";
  // The "because" clause names the most recent reason honestly. Budget
  // skips get the monthly-reset note; other failure reasons do not.
  const becauseClause = summary.reasonCode
    ? `because ${reasonLabel.toLowerCase()}`
    : "for a reason we could not classify";
  const resetNote = summary.hasSkippedDueToBudget
    ? " Free-tier captures reset monthly and skipped ones do not retry."
    : "";
  return (
    <section className="f9-ads-sec" aria-labelledby="brand-capture-failures-title">
      <div className="f9-container">
        <div className="f9-ads-sec-head">
          <div className="f9-ads-sec-head-left">
            <span className="f9-ads-sec-eyebrow">Checks that did not become an alert</span>
            <h2 id="brand-capture-failures-title">What we checked, even when it didn’t alert</h2>
          </div>
          <span className="f9-ads-sec-meta">
            {`${summary.count} ${countWord} on record`}
          </span>
        </div>
        <p
          className="f9-wk-dim"
          data-testid="skipped-captures-summary"
        >
          {`${summary.count} ${countWord} on this brand ${rangeLabel} ${becauseClause}.${resetNote} `}
          <Link to={signupPath}>See run history</Link>
          {" or "}
          <Link to={signupPath}>upgrade to add 50 captures/month</Link>
          {`.`}
        </p>
        <CaptureFailuresDetails domain={domain} />
        <p className="f9-wk-dim">
          Every check we ran is listed — including the ones that didn’t produce an
          alert, with the reason. A failed capture is never an alert, but it is never
          hidden either.
        </p>
      </div>
    </section>
  );
}

/**
 * A `<details>` element that lazy-loads the full per-entry capture-failure
 * list from the `api.ads.capture-failures.$domain` endpoint on expand. The
 * list is never in the loader data (issue #1345, accept #3) — it is fetched
 * only when a buyer chooses to see it.
 */
function CaptureFailuresDetails({ domain }: { domain: string }) {
  const [entries, setEntries] = useState<DomainCaptureFailureEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  function onToggle(open: boolean) {
    if (!open || entries !== null || loading) return;
    setLoading(true);
    setError(false);
    fetch(`/api/ads/capture-failures/${encodeURIComponent(domain)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { entries?: DomainCaptureFailureEntry[] };
        setEntries(json.entries ?? []);
      })
      .catch(() => {
        setError(true);
      })
      .finally(() => {
        setLoading(false);
      });
  }

  return (
    <details className="f9-quiet-details" onToggle={(e) => onToggle(e.currentTarget.open)}>
      <summary>See every check on record</summary>
      {loading ? (
        <p className="f9-wk-dim">Loading…</p>
      ) : error ? (
        <p className="f9-wk-dim">Could not load the full list right now.</p>
      ) : entries === null ? null : entries.length === 0 ? (
        <p className="f9-wk-dim">No entries.</p>
      ) : (
        <ul className="f9-quiet-list">
          {entries.map((entry) => {
            const reason = formatCaptureAttemptReasonLabel(
              entry.reasonCode as CaptureAttemptReasonCode | null,
            );
            const suffix = entry.reasonCode ? ` (${entry.reasonCode})` : "";
            const where = entry.urlChecked ? ` · ${shortUrl(entry.urlChecked)}` : "";
            return (
              <li key={entry.id} className="f9-quiet-list-item">
                <span className="f9-quiet-list-copy">
                  {`${reason}${where}.${suffix} No alert sent.`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}

/**
 * The shape of a single entry returned by the
 * `api.ads.capture-failures.$domain` endpoint — mirrors `DomainCaptureFailure`
 * without importing the server-only type.
 */
interface DomainCaptureFailureEntry {
  id: string;
  status: "capture_failed" | "skipped_due_to_budget";
  reasonCode: string | null;
  urlChecked: string | null;
  checkedAt: string;
}

const SKIP_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "UTC",
});

function formatSkipDate(iso: string): string {
  try {
    return SKIP_DATE_FORMATTER.format(new Date(iso));
  } catch {
    return iso;
  }
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

/**
 * Visible breadcrumb nav for the /ads/:domain page (issue #1418). Rendered
 * from the same `brandPageBreadcrumbItems` trail the BreadcrumbList JSON-LD
 * above uses, so the two can never drift. Home (Five to Nine) and the Ads
 * parent link out; the current brand page is the last, non-link item.
 * Renders only on the cached-indexable page (the cache-miss shell
 * 301-redirects and never reaches this component anyway).
 */
function BrandBreadcrumbs({ data }: { data: BrandPageLoaderData }) {
  const items = brandPageBreadcrumbItems(data);
  if (!items) {
    return null;
  }
  return (
    <nav className="f9-ads-breadcrumb" aria-label="Breadcrumb">
      <div className="f9-container">
        <ol>
          {items.map((item, index) => {
            const isLast = index === items.length - 1;
            return (
              <li key={item.name}>
                {isLast ? (
                  <span aria-current="page">{item.name}</span>
                ) : (
                  <Link to={item.pathname}>{item.name}</Link>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
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
  // The wall always shows every cached creative; attribution analytics above
  // it speak only about the verified-linked subset (see the loader).
  const totalCount = data.ads.length;
  const adWord = totalCount === 1 ? "ad" : "ads";
  const watchLabel = `Watch ${data.domain}`;
  const allBrandOwned = totalCount > 0 && data.brandOwnedAdCount === totalCount;
  // Wall title: when the wall mixes verified-link and search-only creatives,
  // report BOTH counts so the header is honest in the same breath the cards
  // separate visually (accept #2). When every card is one kind, keep the
  // existing single-count form.
  const splitWallMixes =
    data.verifiedLinkCount > 0 && data.unverifiedMatchCount > 0;
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
      {/* 0. BREADCRUMB — visible nav + source for the BreadcrumbList JSON-LD
          (issue #1418). Rendered from the same brandPageBreadcrumbItems the
          JSON-LD block above uses, so the structured data can never drift
          from what the visitor sees: Home (Five to Nine) > Ads > <brand>.
          The last item is the current page and is not a link. */}
      <BrandBreadcrumbs data={data} />

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

            <BrandScoreCard aggression={data.aggression} observationDays={data.observationDays} />
          </div>

          {/* 1b. CAPTURE-VALIDITY TRUST LINK — "no phantom changes" (issue
              #1320). The Ad Aggression Score and every screenshot on this
              page are proof-backed. This link names the public, checkable
              rule set for what we refuse to alert on (challenge pages,
              cookie walls, partial SPA shells, error pages) — the trust
              claim that separates us from the category's false-positive
              alert noise. Points at the canonical /capture-rules path
              (#1432); /proof is its legacy 301 alias. */}
          <p className="f9-wk-dim f9-ads-proof-note">
            {"No phantom changes: every alert from this page is backed by a saved capture. "}
            <Link to={CAPTURE_RULES_PUBLIC_PATH}>What we refuse to alert on</Link>
          </p>

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
                CTA and form change hits your inbox with a screenshot when the capture includes one, the page text, and the link.
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
      <BrandCaptureFailures summary={data.captureFailuresSummary} domain={data.domain} signupPath={signupPath} />

      {/* 5. THE ADS — the wall of real creatives */}
      <section className="f9-ads-sec" aria-labelledby="brand-wall-title">
        <div className="f9-container">
          <div className="f9-ads-sec-head">
            <div className="f9-ads-sec-head-left">
              <span className="f9-ads-sec-eyebrow">
                {data.freshForLiveClaim ? "Running right now" : "From the last check"}
              </span>
              <h2 id="brand-wall-title">{
                splitWallMixes
                  ? `All ${totalCount} ${adWord} — ${data.verifiedLinkCount} verified, ${data.unverifiedMatchCount} matched the search`
                  : `All ${totalCount} ${adWord}, on the wall`
              }</h2>
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
            partnerCampaignAdIds={data.partnerCampaignAdIds}
          />

          {/* AD-AGGRESSION METHODOLOGY FOOTER — "/ad-aggression" cross-link
              (issue #1552). The Ad Aggression Score card is the page's named
              differentiator, but the score alone is a number with no
              explanation for the buyer landing from an SEO query. This footer
              points that curiosity at the public formula — a link magnet that
              converts the score into trust. Shown only on populated pages (≥1
              verified-linked ad), which is exactly when the score can render;
              a matched-but-unverified wall has no score to explain. Internal
              nav, same tab. */}
          {data.verifiedLinkCount > 0 ? (
            <p className="f9-wk-dim f9-ads-wall-foot">
              {"The Ad Aggression Score comes from a public formula, not a black box. "}
              <Link to={AD_AGGRESSION_METHODOLOGY_PATH}>
                How the Ad Aggression Score is calculated
              </Link>
            </p>
          ) : null}
        </div>
      </section>

      {/* 6. BRAND FAQ — rendered from the same array as the FAQPage JSON-LD
          so the visible copy can never drift from the structured data. Every
          answer is grounded in content the page already shows (the Ad
          Aggression Score card, the "Last checked" stamp, the verified-link
          labels, the Watch CTA). Hidden on noindex pages and the cache-miss
          shell, which 301-redirects and never reaches this component. */}
      {(() => {
        const faq = data.noindex ? null : brandPageFaqEntries(data);
        if (!faq) return null;
        return (
          <section className="f9-ads-sec" aria-labelledby="brand-ads-faq-title">
            <div className="f9-container">
              <div className="f9-ads-sec-head">
                <div className="f9-ads-sec-head-left">
                  <span className="f9-ads-sec-eyebrow">FAQ</span>
                  <h2 id="brand-ads-faq-title">{`Common questions about ${data.brandName}'s ads`}</h2>
                </div>
              </div>
              <dl className="proof-trail-list">
                {faq.map((entry) => (
                  <div key={entry.question}>
                    <dt>{entry.question}</dt>
                    <dd>{entry.answer}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>
        );
      })()}

      {/* 6b. RELATED BRANDS — issue #1417. The /ads/:domain pages were
          orphans: none linked to any other /ads page, so a buyer who landed
          on /ads/nike.com could not find /ads/adidas.com without going back
          to search, and Google saw no internal link equity between brand
          pages. This section cross-links this page to a deterministic set of
          OTHER indexable brand pages (the current domain is always excluded)
          plus the /brands hub, so every sitemap /ads page carries at least
          one internal link to another /ads page. Hidden only when no other
          indexable brand pages exist (single-brand sitemap or a cache
          hiccup) — it never invents a brand. */}
      {data.relatedBrands.length > 0 ? (
        <BrowseTrackedCompetitors links={data.relatedBrands} />
      ) : null}

      {/* 7. CLOSER */}
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
 * The "pointing at" link-claim H1 pairs ONLY with the no-score state (no
 * Aggression Score card renders): once verified evidence clears the score
 * floor the H1 must speak the verified "linking to" phrasing, never the
 * hedged "pointing at" (issue #1447).
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
    if (!data.aggression) {
      // No score card renders (the hedge state): the hedged "pointing at"
      // link-claim H1 is legal here and only here (issue #1447).
      return data.freshForLiveClaim
        ? `${verifiedPhrase} ${data.verifiedLinkCount === 1 ? "is" : "are"} pointing at ${data.domain} right now.`
        : `The last check found ${verifiedPhrase} pointing at ${data.domain}.`;
    }
    // The Aggression Score card renders, which proves the capture carries
    // verified link evidence — the H1 speaks the verified "linking to"
    // phrasing instead of the hedged "pointing at" (issue #1447).
    return data.freshForLiveClaim
      ? `${verifiedPhrase} ${data.verifiedLinkCount === 1 ? "is" : "are"} linking to ${data.domain} right now.`
      : `The last check found ${verifiedPhrase} linking to ${data.domain}.`;
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
          every change lands in your inbox with a screenshot when the capture includes one, the page text, and the link.
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
        <BrandCaptureFailures summary={data.captureFailuresSummary} domain={data.domain} signupPath={signupPath} />

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
