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
 *   - SEEDED brands (named in data/seed-lists/*.json) with ZERO verified-linked
 *     ads 301-redirect to /search?q=<domain> instead of rendering the noindex
 *     thin shell (issue #1306: retire empty marketplace shells — stockx.com /
 *     goat.com). Non-seeded thin pages still render noindex (#1442).
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

// Issue #2001 — a single transient D1/KV read hiccup used to surface as a
// spurious cache-miss 301 (or a 500) on the money-path /ads/:domain step.
// The bounded retry gives one extra attempt before the miss/redirect path.
import { withTransientRetry } from "~/lib/transient-retry.server";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useState } from "react";

import { AdCreative } from "~/components/ads/ad-creative";
import { BrandAdWall, WALL_VISIBLE_ADS } from "~/components/ads/brand-ad-wall";
import { BrandChangeTimeline } from "~/components/ads/brand-change-timeline";
import { BrandScoreCard } from "~/components/ads/brand-score-card";
import { BrandStatLine } from "~/components/ads/brand-stat-line";
import { BrandTicker, TICKER_MAX_ITEMS, type BrandTickerAd } from "~/components/ads/brand-ticker";
import { BrowseTrackedCompetitors } from "~/components/ads-internal-links";
import { BrandPageSourceSections } from "~/components/brand-page/source-sections";
import { MarketingFooter } from "~/components/marketing-footer";
import { MarketingNav } from "~/components/marketing-nav";
import { OfferTimelineLedger } from "~/components/offer-timeline-ledger";
import type { AdsDomainRecentChange } from "~/lib/ads-domain-recent-changes.server";
import { formatWatchEventTypeLabel } from "~/lib/watch-event-display";
import { getOptionalCloudflareContext } from "~/lib/cloudflare-context";
import { rerankDigestBrief } from "~/lib/digest-rerank";
import { CAPTURE_RULES_PUBLIC_PATH, NO_PHANTOM_CHANGES_PUBLIC_PATH } from "~/lib/capture-validity-public-rules";
import { AD_AGGRESSION_METHODOLOGY_PATH } from "~/lib/aggression-score";
import type { IndexableAdsLink } from "~/lib/ads-internal-links";
import type {
  BrandChangeEvent,
  BrandIntelTeaser,
  BrandPageAggression,
} from "~/lib/brand-page.server";
import { brandOwnedAdIdSet } from "~/lib/brand-page.server";
import { adLongevityDays } from "~/lib/ad-display";
import { dedupeTickerBodies } from "~/lib/ticker-dedup";
import { isSeededBrandDomain } from "~/lib/ads-domain-publisher.server";
import { brandCategoryForDomain } from "~/lib/brand-categories";
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
import type { BrandPageSourceSnapshot } from "~/components/brand-page/source-snapshots.server";

/**
 * The hydrated projection of one cached creative — the wall, the ticker and
 * the stat line (issue #2391).
 *
 * Every field here is read by a component that receives `ads`: BrandAdWall
 * (plus AdCreative, AdLongevityPill and the ad-display / landing-page-display
 * helpers they call), BrandTicker, and the stat line's split-testing count.
 * Nothing else about a creative reaches the browser — see
 * `projectBrandPageAd` for the audit that cleared the dropped fields.
 */
export type BrandPageAd = Pick<
  AdRecord,
  | "metaAdId"
  | "advertiser"
  | "previewHeadline"
  | "hook"
  | "cta"
  | "format"
  | "landingPageUrl"
  | "firstSeenAt"
  | "lastSeenAt"
  | "activeStatusObserved"
  | "source"
  | "variantCount"
  | "creativeImageUrl"
  | "linkVerifiedDomain"
>;

export interface BrandPageLoaderData {
  domain: string;
  brandName: string;
  hasCachedAds: boolean;
  /**
   * The creatives the wall renders (issue #2704): the loader applies the
   * wall's own deterministic sort (verified-linked first, then longevity
   * measured from the capture time — never wall-clock) and slices to
   * `WALL_VISIBLE_ADS`, each carrying its own verified-link signal,
   * projected to the fields the page renders (`BrandPageAd`, issue #2391).
   * The client cannot see more creatives than the server shows, so the
   * hydration payload never ships a creative no renderer reads. The full
   * capture size is `adCount`; each card's badge and ordering read the
   * `linkVerifiedDomain` the loader stamps from its one verification pass.
   */
  ads: BrandPageAd[];
  /**
   * Issue #2704 — the full cached-capture size. The loader ships only the
   * creatives the wall renders (`ads`, above), so the header copy
   * ("All N ads, on the wall"), the "+N more" conversion tile, the meta
   * description and the brand-ownership wording all read THIS count, never
   * `ads.length` — a sliced array must never understate the capture.
   */
  adCount: number;
  /**
   * Issue #2704 — the exact creatives the capture ticker renders, computed
   * by the loader with the same dedupe the ticker component applies
   * (`dedupeTickerBodies`, snapshot order, longest variant per body,
   * `TICKER_MAX_ITEMS` cap). A second full projected array beside the wall
   * would re-serialize creatives the belt never shows; this narrow
   * projection (id, headline, hook, source, first/last seen) is the whole
   * belt's input. Order is the snapshot order, so the belt renders exactly
   * the items it rendered when it read the full capture.
   */
  tickerAds: BrandTickerAd[];
  /**
   * Issue #2704 — how many VERIFIED-LINKED cached creatives carry more than
   * one variant (the stat line's "Split-testing N/total" cell). The strip
   * used to iterate the full verified subset client-side just to count this
   * one predicate; the loader counts it from the same records it already
   * derives the score, teaser and change feed from, and the payload ships a
   * number instead of the array.
   */
  verifiedTestedCount: number;
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
   * True when this domain's `/timeline/:domain` page is in the sitemap's
   * indexable set (issue #1931). Gates the Offer Timeline cross-link so a
   * demo/empty/410 timeline is never linked — the same signal the sitemap
   * uses. Independent of `offerTimelineEntries` (which is the ledger the
   * section renders); a timeline can be indexable with a non-empty ledger,
   * and the cross-link only renders when BOTH hold.
   */
  timelineIndexable: boolean;
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
   * link equity flowing between brand pages. This deterministic cluster of
   * OTHER indexable brand pages (the current domain always excluded, see
   * pickRelatedBrandLinks) restores the cross-links; since issue #2048 the
   * cluster is >=10 siblings (RELATED_BRAND_LINK_COUNT) so the programmatic
   * cohort is a connected crawlable graph, not isolated pages. Empty on a
   * cache hiccup or a single-brand sitemap — the section hides in that case.
   * The `BrowseTrackedCompetitors` component renders these (as the "More
   * tracked brands" cluster), always backed by a link to the /brands hub so
   * every brand page also reaches the full list.
   */
  relatedBrands: IndexableAdsLink[];
  /**
   * Same-category sibling /ads/:domain pages for the "Also tracked in
   * <category>" module (issue #2298). The /ads pages were lateral dead-ends
   * for category browsing: the "More tracked brands" cluster (relatedBrands)
   * links 12 alphabetical siblings, but a buyer on /ads/nike.com had no quick
   * path to the OTHER Sport & footwear brands specifically. This set links up
   * to 6 same-category siblings, read from the SAME category source /brands
   * uses (`brandCategoryForDomain` in `~/lib/brand-categories` — never a
   * second category list), in stable alphabetical order, limited to brands
   * with live /ads pages (the sitemap indexability signal — no soft-404
   * links). Null when no same-category sibling has a live /ads page, so the
   * module omits entirely. Deterministic: identical HTML across deploys.
   * Optional so existing fixtures that do not exercise it stay valid; the
   * loader always sets it.
   */
  categorySiblings?: { category: string; links: IndexableAdsLink[] } | null;
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
  /**
   * Issue #2112 — "changed in the last 7 days" proof. When any watchlist
   * tracks this advertiser's domain, its last-7d watch_event rows ship as
   * this safe projection: event type + change mark + capture date ONLY — no
   * user data, no watchlist names, no owner identifiers (enforced by
   * `loadAdsDomainRecentChanges`, which never puts them in the loader data).
   * Empty when no watchlist tracks the domain or nothing changed — the
   * section hides in that case.
   */
  recentWatchChanges: AdsDomainRecentChange[];
  /**
   * Issue #2200 — the latest snapshot per LIVE competitor-monitoring source
   * (Google Ads, Google Search, LinkedIn, TikTok, subdomains, hiring) for
   * this brand, read from the same generic snapshot store the logged-in
   * competitor page uses. A source appears only when (a) its claim row is
   * live (adapter implemented + env-enabled) AND (b) a snapshot exists for
   * a watchlist tracking this domain. Empty when no live source has a
   * snapshot — the source-sections block omits entirely. The public page
   * never triggers a fetch; this is a read-only D1 read.
   */
  sourceSnapshots: BrandPageSourceSnapshot[];
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
    snapshot = await withTransientRetry(() =>
      loadBrandPageCacheSnapshot(env, {
        domain: brand.domain,
        visitorCountry,
      }),
    );
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

  // Issue #2390 — these six secondary reads are provably independent: each
  // derives only from `env` + `brand.domain`, none consumes another's result,
  // and each already carries its OWN catch-and-degrade path (the five local
  // try/catch wrappers below, plus `loadDomainCaptureFailures`' own internal
  // catch that returns []). Awaited one by one they formed a D1 waterfall
  // (measured /ads TTFB 0.71s), so they now run concurrently and the page
  // pays the slowest read instead of the sum.
  //
  // Deliberately NOT a `DB.batch()` call: batch fails as a unit, so one bad
  // statement would sink every read and destroy the per-read degrade paths
  // that keep a D1 hiccup from 500ing the page. Each promise keeps its own
  // wrapper.
  const [
    offerTimelineEntries,
    timelineIndexable,
    recentWatchChanges,
    sourceSnapshots,
    internalLinksResult,
    captureFailures,
  ] = await Promise.all([
    // Timeline is a secondary surface. A D1 hiccup must hide the section,
    // never 500 the ads page or trigger a live capture.
    (async (): Promise<OfferLedgerEntry[]> => {
      try {
        const loaded = await loadOfferTimeline(env, { domain: brand.domain, asOf: null });
        return loaded.entries;
      } catch (error) {
        console.warn("Brand page offer timeline read failed; hiding the section.", {
          errorName: error instanceof Error ? error.name : typeof error,
        });
        return [];
      }
    })(),

    // Issue #1931 — the Offer Timeline cross-link must be gated by the SAME
    // indexability signal the sitemap uses (`loadIndexableTimelineEntries`), so
    // a demo/empty/410 timeline is never linked. This is independent of the
    // ledger above: the section renders the ledger, but the cross-link only
    // appears when the sitemap would list the /timeline/:domain URL. A D1
    // hiccup degrades to `false` (no cross-link) rather than 500 the page.
    (async (): Promise<boolean> => {
      try {
        const { resolveIndexableTimelineLinkForDomain } = await import(
          "~/lib/ads-internal-links.server"
        );
        return (await resolveIndexableTimelineLinkForDomain(env, brand.domain)) !== null;
      } catch (error) {
        console.warn("Brand page timeline indexability read failed; omitting the cross-link.", {
          errorName: error instanceof Error ? error.name : typeof error,
        });
        return false;
      }
    })(),

    // Issue #2112 — "changed in the last 7 days" proof. When any watchlist
    // tracks this advertiser's domain, load its last-7d watch_event rows and
    // ship only the public projection (event type, change mark, capture date).
    // Bounded D1 read; a hiccup degrades to [] (the section hides) rather than
    // 500ing the page or triggering any paid operation.
    (async (): Promise<AdsDomainRecentChange[]> => {
      try {
        const { loadAdsDomainRecentChanges } = await import(
          "~/lib/ads-domain-recent-changes.server"
        );
        return await loadAdsDomainRecentChanges(env, brand.domain);
      } catch (error) {
        console.warn("Brand page recent watch-changes read failed; hiding the section.", {
          errorName: error instanceof Error ? error.name : typeof error,
        });
        return [];
      }
    })(),

    // Issue #2200 — load the latest snapshot per LIVE competitor-monitoring
    // source for this brand, from the same generic snapshot store the
    // logged-in competitor page uses. Read-only; the public page never
    // triggers a fetch. A source renders only when its claim row is live
    // (adapter implemented + env-enabled) AND a snapshot exists. A D1 hiccup
    // degrades to [] (the source-sections block omits) rather than 500ing.
    (async (): Promise<BrandPageSourceSnapshot[]> => {
      try {
        const { loadBrandPageSourceSnapshots } = await import(
          "~/components/brand-page/source-snapshots.server"
        );
        return await loadBrandPageSourceSnapshots(env, brand.domain);
      } catch (error) {
        console.warn("Brand page source snapshots read failed; hiding the sections.", {
          errorName: error instanceof Error ? error.name : typeof error,
        });
        return [];
      }
    })(),

    // Issue #1417: the sitemap's /ads/:domain pages were orphaned — none
    // linked to another /ads page, so a buyer landing on /ads/nike.com could
    // not discover /ads/adidas.com without going back to search, and Google
    // saw no internal link equity flowing between brand pages. Load the other
    // indexable brand-page links (the same sitemap indexability signal) and
    // pick this page's deterministic "Related brands" set. Cache-only: one
    // bounded D1 read; a hiccup degrades to null (both dependent sections
    // hide) rather than 500ing the page or triggering any paid operation.
    //
    // Note: `loadIndexableAdsInternalLinks` catches its own D1 failures and
    // returns [], so its internal degrade — not this wrapper — is the live
    // path for a database hiccup. The wrapper here covers an import/module
    // failure only; `null` is therefore the sentinel for "the read never
    // produced a value", distinct from the read's own empty-array result.
    (async (): Promise<IndexableAdsLink[] | null> => {
      try {
        const { loadIndexableAdsInternalLinks } = await import(
          "~/lib/ads-internal-links.server"
        );
        return await loadIndexableAdsInternalLinks(env);
      } catch (error) {
        console.warn("Brand page related-brands load failed; omitting cross-links.", {
          errorName: error instanceof Error ? error.name : typeof error,
        });
        return null;
      }
    })(),

    // Issues #1289 / #1345: surface failed/suppressed landing-page captures
    // for this domain so the public page names what we checked and why it did
    // not become an alert. The full array is NOT leaked into the loader data —
    // only a server-rendered summary (count, date range, reason) ships to the
    // client. The per-entry list is lazy-loaded on expand via the
    // `api.ads.capture-failures.$domain` endpoint. Bounded D1 read; it already
    // degrades to [] internally on any D1 failure (`loadDomainCaptureFailures`
    // in ~/lib/offer-timeline.server), so no extra wrapper is needed here and
    // none is added — this read is independent of the other five and joins
    // them directly.
    (async () => {
      const { loadDomainCaptureFailures } = await import("~/lib/offer-timeline.server");
      return await loadDomainCaptureFailures(env, { domain: brand.domain });
    })(),
  ]);

  const { summarizeDomainCaptureFailures } = await import("~/lib/offer-timeline.server");
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
  let categorySiblings: { category: string; links: IndexableAdsLink[] } | null = null;
  // `internalLinksResult === null` means the concurrent read above never
  // produced a value at all (import/module failure) and already logged; both
  // dependent sections stay hidden. An empty array is a real result and still
  // runs the link picking below, which is pure in-memory work.
  if (internalLinksResult !== null) {
    const { pickRelatedBrandLinks } = await import("~/lib/ads-internal-links");
    const allLinks = internalLinksResult;
    relatedBrands = pickRelatedBrandLinks(allLinks, brand.domain);
    // Issue #2298 — "Also tracked in <category>" module: same-category
    // siblings from the SAME category source /brands uses
    // (`brandCategoryForDomain` in ~/lib/brand-categories — never a second
    // list). Up to 6, stable alphabetical order, limited to brands with live
    // /ads pages (allLinks is the sitemap indexability signal, so no soft-404
    // link can ever ship). Omit the module when no same-category sibling has
    // a live /ads page. Deterministic: the alphabetical sort + fixed cap keep
    // the HTML identical across deploys.
    const currentCategory = brandCategoryForDomain(brand.domain);
    const siblings = allLinks
      .filter(
        (link) =>
          link.domain !== brand.domain &&
          brandCategoryForDomain(link.domain) === currentCategory,
      )
      .slice()
      .sort((a, b) => a.domain.localeCompare(b.domain))
      .slice(0, 6);
    categorySiblings =
      siblings.length > 0 ? { category: currentCategory, links: siblings } : null;
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

  // Issue #1306 — retire empty marketplace shells for seeded brands.
  //
  // A seeded brand (one named in a checked-in data/seed-lists/*.json cluster,
  // e.g. the sneaker-resale marketplace nouns stockx.com / goat.com) that
  // resolves to a thin wall with ZERO verified-linked ads cannot ship as a
  // populated brand page: it would render a noindex marketing shell — the
  // exact "We haven't watched … yet" dead-end the issue names, just with an
  // unverified match wall instead of the cache-miss shell. The capture
  // pipeline can see marketplace-adjacent creatives but the homonym / verification
  // wall (goat.com — see #1305) prevents any from linking to the brand domain,
  // so populate is not viable today and the page self-noindexes (#1442).
  //
  // The issue's accept bar is "populate OR retire". For a seeded brand that
  // cannot be populated, retire: 301-redirect to /search?q=<domain> so the
  // buyer lands on a page where they can run a live search immediately, and no
  // noindex empty shell 200s with marketing chrome. This is the seeded-brand
  // generalization of #1282's cache-miss redirect.
  //
  // Scope is deliberately tight: ONLY seeded brands retire on a thin wall, so
  // #1442's render-noindex behavior for non-seeded thin pages (a direct visitor
  // still sees the wall) is preserved. The redirect is self-healing — if a
  // seeded brand later earns a verified-linked ad (e.g. goat.com after #1305's
  // verification matures), verifiedLinkedAds.length > 0 and the page renders.
  if (snapshot && verifiedLinkedAds.length === 0 && isSeededBrandDomain(brand.domain)) {
    throw redirect(`/search?q=${encodeURIComponent(brand.domain)}`, 301);
  }

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

  // Issue #2391 — the hydration payload carries each cached creative ONCE.
  //
  // Two things were in the payload that no renderer read. First, a second
  // full `AdRecord[]` (`verifiedLinkedAds`) beside `ads` — on live
  // /ads/nike.com 48.5KB of JSON next to the wall's 49.0KB, though the stream
  // tokenizer shares the identical strings, so its marginal cost is ~4.8KB.
  // (Since #2704 the id list is gone too — `linkVerifiedDomain` on each
  // shipped record is the single signal, and the loader's counts carry the
  // aggregates.)
  //
  // Second, the discovery-time fields no client renderer reads. Dropped from
  // this projection: analysisFields (~13.7KB of the token stream on that
  // page), body, bodySecondary, previewSubhead, offer, languageLabel,
  // destinationType, adSnapshotUrl, countries, platforms, active,
  // researchSummary, advertiserPageId, creativeText, creativeFormatHint,
  // creativeTextCaptureMethod, creativeTextMetadata, landingPage,
  // evidenceCapturedAt, canonicalRevision, tags, domainMatch.
  //
  // Audited against every reader of `ads`: BrandAdWall (+ AdCreative,
  // AdLongevityPill, the ad-display and landing-page-display helpers they
  // call), BrandTicker, the stat line's split-testing count, and the
  // meta/headers code (which reads counts, never fields).
  // `adsPageServiceJsonLd` takes no ad records at all.
  //
  // Issue #2704 tightens this further: `ads` holds only the wall's visible
  // slots, `tickerAds` only the belt's slots, and the split-testing count
  // ships as a number — the meta/headers code reads `adCount` for the full
  // capture size.

  // Issue #2704 — ship only what the page renders. The wall's visible slots
  // are selected here with the SAME deterministic sort BrandAdWall applies
  // (verified-linked first, then longevity measured from the capture time),
  // so the client's re-sort of the shipped slice is a no-op and the
  // hydration payload carries no creative the wall never shows. The
  // capture-time key (the issue #2142 basis the longevity pill already
  // uses) makes the selection stable across server render and hydration —
  // a wall-clock key would let two same-length creatives swap ranks
  // between the server render and the browser.
  const wallSortKey = snapshot ? new Date(snapshot.fetchedAt) : now;
  const projectedWallAds = wallAds.map(projectBrandPageAd);
  const renderedWallAds = [...projectedWallAds]
    .sort((a, b) => {
      const aVerified = a.linkVerifiedDomain ? 1 : 0;
      const bVerified = b.linkVerifiedDomain ? 1 : 0;
      if (aVerified !== bVerified) return bVerified - aVerified;
      return (adLongevityDays(b, wallSortKey) ?? 0) - (adLongevityDays(a, wallSortKey) ?? 0);
    })
    .slice(0, WALL_VISIBLE_ADS);

  // The capture belt reads the full projected array only to dedupe bodies
  // and cap at `TICKER_MAX_ITEMS`. Run that exact selection here — same
  // dedupe lib, same body derivation, snapshot order, longest variant per
  // body — and ship just the belt's narrow projection, so the payload
  // carries no ticker candidate the belt never renders.
  const tickerAds: BrandTickerAd[] = dedupeTickerBodies(
    // The belt filters empty bodies BEFORE dedupe — mirror that order here so
    // a bodiless creative never takes a shipped slot the belt then drops.
    projectedWallAds.filter((ad) => ad.previewHeadline?.trim() || ad.hook?.trim()),
    (ad) => ad.previewHeadline?.trim() || ad.hook?.trim() || "",
  )
    .slice(0, TICKER_MAX_ITEMS)
    .map((ad) => ({
      metaAdId: ad.metaAdId,
      previewHeadline: ad.previewHeadline,
      hook: ad.hook,
      source: ad.source,
      firstSeenAt: ad.firstSeenAt,
      lastSeenAt: ad.lastSeenAt,
    }));


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
    ads: renderedWallAds,
    adCount: snapshotAds.length,
    tickerAds,
    verifiedTestedCount: verifiedLinkedAds.filter((ad) => (ad.variantCount ?? 0) > 1).length,
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
    timelineIndexable,
    adLibraryCountry: snapshot ? brandPageAdLibraryCountryLabel(snapshot.country) : null,
    noindex,
    relatedBrands,
    categorySiblings,
    canonicalPath: `/ads/${brand.domain}`,
    captureFailuresSummary,
    recentWatchChanges,
    sourceSnapshots,
  };
}

/**
 * Project one wall creative down to the fields the page renders (issue
 * #2391): the hydration payload never ships a field no renderer reads. Typed
 * as `BrandPageAd`, so a component that starts reading a dropped field is a
 * type error rather than a silently undefined value in the browser.
 */
export function projectBrandPageAd(ad: AdRecord): BrandPageAd {
  return {
    metaAdId: ad.metaAdId,
    advertiser: ad.advertiser,
    previewHeadline: ad.previewHeadline,
    hook: ad.hook,
    cta: ad.cta,
    format: ad.format,
    landingPageUrl: ad.landingPageUrl,
    firstSeenAt: ad.firstSeenAt,
    lastSeenAt: ad.lastSeenAt,
    activeStatusObserved: ad.activeStatusObserved,
    source: ad.source,
    variantCount: ad.variantCount,
    creativeImageUrl: ad.creativeImageUrl,
    linkVerifiedDomain: ad.linkVerifiedDomain,
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
    data.adCount > 0 && data.brandOwnedAdCount === data.adCount;
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
  const totalCount = data.adCount;
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
 * /methodology, four sub-scores Velocity/Testing/
 * Freshness/Persistence), the visible "Last checked …" stamp and the
 * scheduled-scan cadence (Scout every 6h, Starter/Agency every 3h), the
 * verified-link vs matching-only distinction the page already labels, and
 * the "Track {domain}" CTA. The brand name and domain are interpolated from
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
      question: `How long do ${brandName}'s ads usually run?`,
      answer: `Ads that stay live for 30+ days are the market's usual winner signal — a creative that keeps running is one that keeps working. Each ad card shows how long that ad has been running, measured from its first-seen date up to the capture shown on this page (the "Last checked" stamp), so the count reflects the data we collected, not the moment you view the page.`,
    },
    {
      question: `Can I get an email when ${brandName}'s ads or offer change?`,
      answer: `Yes. The "Track ${domain} — free" button on this page starts a free account, and the first scan runs the moment you land. After that, every ad, offer, CTA, and form change hits your inbox with a screenshot when the capture includes one, the page text, and the source link. Quiet periods still send a heartbeat so silence always means we looked.`,
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
  // Issue #2051 — the primary acquisition CTA deep-links into signup with the
  // viewed competitor prefilled (`?competitor=<domain>`), so the SEO landing
  // page carries the brand the visitor just read about straight into
  // onboarding. `redirectTo` keeps the existing `website=` prefill wiring so
  // the first thing the new user tracks is the brand on this page.
  const trackSignupPath = `/auth/signup?competitor=${encodeURIComponent(data.domain)}&redirectTo=${encodeURIComponent(postSignupPath)}`;
  const allBrandOwned =
    data.adCount > 0 && data.brandOwnedAdCount === data.adCount;

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
       * the oldest stored offer snapshot the page's own Offer Timeline
       * section renders (datePublished, issue #2303), the Track {domain}
       * offer with Five to Nine as the provider, the
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
                // Issue #2303: answer engines quoting an "as of" date got
                // only the last-check stamp, never the first-seen one. The
                // first-seen date is the domain's earliest stored snapshot
                // (`landing_page_snapshot.captured_at`, ascending order) —
                // the exact row and column `/timeline/:domain` already emits
                // as its Dataset `datePublished`. It is the same array the
                // page's own Offer Timeline section below renders, so
                // datePublished is always a date the visible page shows.
                // Omitted entirely when the domain has zero stored
                // snapshots (no Offer Timeline ledger): a page with nothing
                // stored never claims a publication date.
                datePublished: data.offerTimelineEntries[0]?.capturedAt ?? undefined,
                dateModified: data.lastCheckedAt ?? undefined,
                aboutName: data.brandName,
                // Issue 964: link this brand page to its citable Offer
                // Timeline Dataset so answer engines can follow the
                // relationship from the brand page to the change-ledger.
                // Only when a stored timeline exists AND the timeline is in
                // the sitemap's indexable set (issue #1931) — a missing
                // timeline would point hasPart at a 410 Gone URL.
                hasPart:
                  data.timelineIndexable && data.offerTimelineEntries.length > 0
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
          ads={data.tickerAds}
          // The ticker tag names the brand only when the creatives are its
          // own; otherwise it tags the domain the ads link to.
          brandName={allBrandOwned ? data.brandName : data.domain}
          fresh={data.freshForLiveClaim}
        />
      ) : null}
      <MarketingNav />

      {data.hasCachedAds ? (
        <BrandAdsResults
          data={data}
          liveSearchPath={liveSearchPath}
          signupPath={signupPath}
          trackSignupPath={trackSignupPath}
        />
      ) : (
        <BrandAdsShell data={data} liveSearchPath={liveSearchPath} signupPath={signupPath} />
      )}

      {/* Weekly-brief cross-link (issue #2143): every public brand page feeds
          the stored-moves brief, so the page footer points at it. */}
      <p className="f9-wk-dim f9-ads-wall-foot">
        {"Stored moves across every tracked brand land in the weekly brief. "}
        <Link to="/briefs/weekly">See this week&apos;s offer moves</Link>
      </p>

      <MarketingFooter />
    </main>
  );
}

/**
 * Issue #2112 — public "Changed in the last 7 days" proof strip. Renders the
 * loader's safe projection per event: the type label, the caught before→after
 * change mark when one is stored (the BL-030 struck-old/green-new mark), and
 * the capture date. Nothing else about the event — no title, summary,
 * watchlist name, or owner identifier — is ever in the loader data. Hidden
 * when no watchlist tracks the domain or nothing changed (never an empty
 * card).
 */
function BrandRecentWatchChanges({ changes }: { changes: AdsDomainRecentChange[] }) {
  if (changes.length === 0) {
    return null;
  }
  return (
    <section className="f9-ads-sec" aria-labelledby="brand-recent-changes-title">
      <div className="f9-container">
        <div className="f9-ads-sec-head">
          <div className="f9-ads-sec-head-left">
            <span className="f9-ads-sec-eyebrow">Captured by watches</span>
            <h2 id="brand-recent-changes-title">Changed in the last 7 days</h2>
          </div>
          <span className="f9-ads-sec-meta">
            {`${changes.length} ${changes.length === 1 ? "change" : "changes"} captured`}
          </span>
        </div>
        <ul className="f9-quiet-list" data-testid="ads-recent-watch-changes">
          {changes.map((change, index) => (
            <li
              key={`${change.eventType}:${change.capturedAt}:${index}`}
              className="f9-quiet-list-item"
            >
              <span className="f9-quiet-list-copy">
                {formatWatchEventTypeLabel(change.eventType)}
                {change.changeMark ? (
                  <>
                    {" — "}
                    <s>{change.changeMark.from}</s>
                    <span aria-hidden="true"> → </span>
                    <ins>{change.changeMark.to}</ins>
                  </>
                ) : null}
                {` · captured ${formatSkipDate(change.capturedAt)}`}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * Display-time guard for extracted CTA text (issue #2320).
 *
 * The landing-page CTA extractor can leak a CSS class name (e.g. `ic-left-nav`)
 * into `ctaText`, and the public offer timeline was rendering it as a labeled
 * fact — "CTA: ic-left-nav" — next to the page's "No proof, no claim" branding,
 * which reads as fabricated data. This predicate rejects any no-space value
 * shaped like a class name at display time. The extractor fix itself is tracked
 * separately (out of scope, issue must-not); this only stops the garbage from
 * rendering.
 */
export function isClassLikeCtaText(value: string | null): boolean {
  if (!value) {
    return false;
  }
  return (
    !/\s/.test(value) &&
    (/^(ic|js)-/.test(value) || /^[a-z]+(-[a-z]+){2,}$/.test(value))
  );
}

const NO_CLEAR_CTA_LABEL = "No clear CTA";

/**
 * Offer Timeline on the public `/ads/:domain` page. Hidden when nothing is
 * stored (never an empty card). Proof-less backfill rows are filtered out by
 * loadOfferTimeline (issue #1284) so only states with both a stored screenshot
 * and page-text extract ever reach this surface.
 */
export function BrandOfferTimeline({
  domain,
  entries,
  timelineIndexable,
}: {
  domain: string;
  entries: OfferLedgerEntry[];
  /**
   * True when this domain's `/timeline/:domain` is in the sitemap's indexable
   * set (issue #1931, collecting-aware per issue #2021). The ledger section
   * renders whenever entries exist, but the cross-link to the full timeline
   * only appears when the sitemap would list that URL — so a route the
   * timeline never serves is never linked.
   */
  timelineIndexable: boolean;
}) {
  if (entries.length === 0) {
    // Issue #2021: a tracked brand with no stored offer states yet still
    // links to its (indexable) collecting timeline — honest "collecting"
    // state, never a link to a 410. Untracked domains keep the section hidden.
    if (!timelineIndexable) {
      return null;
    }
    return (
      <section className="f9-ads-sec" aria-labelledby="brand-offer-timeline-title">
        <div className="f9-container">
          <div className="f9-ads-sec-head">
            <div className="f9-ads-sec-head-left">
              <span className="f9-ads-sec-eyebrow">Landing-page offers</span>
              <h2 id="brand-offer-timeline-title">Offer timeline</h2>
            </div>
            <span className="f9-ads-sec-meta">Collecting</span>
          </div>
          <p className="f9-timeline-empty">
            Collecting — no offer states recorded yet. Once monitoring captures this
            landing page, the dated ledger lands here.
          </p>
          <p className="f9-timeline-also">
            <Link to={`/timeline/${encodeURIComponent(domain)}`}>{`Offer timeline for ${domain}`}</Link>
          </p>
        </div>
      </section>
    );
  }

  const stateWord = entries.length === 1 ? "dated state" : "dated states";
  // Issue #2320: reject CTA values shaped like CSS class names at display time
  // and render "No clear CTA" instead — a leaked `ic-*`/`js-*` class (or a
  // no-space dashed token) must never surface as a captured fact on the public
  // page. The extractor fix is tracked separately; this is render-time only.
  const guardedEntries = entries.map((entry) => {
    if (isClassLikeCtaText(entry.ctaText)) {
      return { ...entry, ctaText: NO_CLEAR_CTA_LABEL };
    }
    return entry;
  });
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
        <OfferTimelineLedger entries={guardedEntries} />
        {timelineIndexable && (
          <p className="f9-timeline-also">
            <Link to={`/timeline/${encodeURIComponent(domain)}`}>{`Full offer timeline for ${domain}`}</Link>
          </p>
        )}
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
  trackSignupPath,
}: {
  data: BrandPageLoaderData;
  liveSearchPath: string;
  signupPath: string;
  trackSignupPath: string;
}) {
  const teaser = data.teaser;
  // The wall header counts the FULL capture (`adCount`); the payload ships
  // only the creatives the wall renders (issue #2704). Attribution analytics
  // above it speak only about the verified-linked subset (see the loader).
  const totalCount = data.adCount;
  const adWord = totalCount === 1 ? "ad" : "ads";
  const watchLabel = `Track ${data.domain}`;
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
            <Link to={NO_PHANTOM_CHANGES_PUBLIC_PATH}>If we send it, the page really changed</Link>
            {" · "}
            <Link to={CAPTURE_RULES_PUBLIC_PATH}>What we refuse to alert on</Link>
          </p>

          {/* 2. Primary CTA strip */}
          <div className="f9-ads-watch-strip">
            <div className="f9-ads-watch-copy">
              <h2>
                {"Track "}
                <span className="f9-ads-watch-g">{data.domain}</span>
                {" — free"}
              </h2>
              <p>
                Create a free account and the first scan runs the moment you land. Every ad, offer,
                CTA and form change hits your inbox with a screenshot when the capture includes one, the page text, and the link.
              </p>
            </div>
            {/* Issue #2051: the primary CTA carries the viewed brand into
                signup via ?competitor=<domain> (the onboarding prefill rides
                in redirectTo as ?website=<domain>). */}
            <Link
              className="f9-ads-watch-btn"
              data-testid="ads-track-cta"
              to={trackSignupPath}
            >
              {`${watchLabel} →`}
            </Link>
          </div>
        </div>
      </section>

      {/* 3. STAT LINE — built only from verified-linked creatives (see loader;
          the split-testing count ships as a number, issue #2704) */}
      {teaser ? (
        <BrandStatLine
          testedCount={data.verifiedTestedCount}
          aggression={data.aggression}
          brandOwnedAdCount={data.brandOwnedAdCount}
          freshnessLabel={data.checkedAgo}
          fresh={data.freshForLiveClaim}
          movesThisWeek={data.changeEvents.length}
          teaser={teaser}
        />
      ) : null}

      {/* 4. WHAT CHANGED THIS WEEK — apply the BET 1 re-rank (#1897) so a bare
          ad_new never appears as a headline "move" with a screenshot (issue
          #1951). Landing-page commercial-field changes are the headline
          cards; ad_new / ad_inactive collapse into a single counted line. */}
      {(() => {
        // The shared BET 1 helper from #1897, imported from the client-safe
        // module it lives in — `rerankBrandChangeFeed` in brand-page.server
        // delegates to exactly this function, so the digest and the /ads page
        // still cannot drift, but the client bundle does not pull in the
        // server-only module (issue #1951 CI build failure).
        const { headlineItems, adChurnSummary } = rerankDigestBrief(data.changeEvents);
        const hasHeadline = headlineItems.length > 0;
        const hasChurn = adChurnSummary.total > 0;
        if (!hasHeadline && !hasChurn) return null;
        return (
          <section className="f9-ads-sec" aria-labelledby="brand-changed-title">
            <div className="f9-container">
              <div className="f9-ads-sec-head">
                <div className="f9-ads-sec-head-left">
                  <span className="f9-ads-sec-eyebrow">The reason to watch</span>
                  <h2 id="brand-changed-title">What changed this week</h2>
                </div>
                <span className="f9-ads-sec-meta">
                  {hasHeadline
                    ? `${headlineItems.length} ${headlineItems.length === 1 ? "move" : "moves"} · each with a saved screenshot`
                    : "No offer changes this week"}
                </span>
              </div>
              <BrandChangeTimeline events={headlineItems} churn={adChurnSummary} />
            </div>
          </section>
        );
      })()}

      {/* 4b. CHANGED IN THE LAST 7 DAYS — issue #2112. Captured proof from
          the watch floor: when any watchlist tracks this domain, its last-7d
          events render as event type + change mark + capture date ONLY — no
          user data, no watchlist names, no owner identifiers (the loader's
          projection is the enforcement point). Hidden when empty. */}
      <BrandRecentWatchChanges changes={data.recentWatchChanges} />

      <BrandOfferTimeline domain={data.domain} entries={data.offerTimelineEntries} timelineIndexable={data.timelineIndexable} />
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
            capturedAt={data.lastCheckedAt}
          />

          {/* AD-AGGRESSION METHODOLOGY FOOTER — "/methodology" cross-link
              (issue #1552 canonical updated by #2022 to /methodology). The Ad
              Aggression Score card is the page's named differentiator, but the
              score alone is a number with no explanation for the buyer landing
              from an SEO query. This footer points that curiosity at the public
              methodology page — a link magnet that converts the score into
              trust. Shown only on populated pages (≥1 verified-linked ad),
              which is exactly when the score can render; a matched-but-unverified
              wall has no score to explain. Internal nav, same tab. */}
          {data.verifiedLinkCount > 0 ? (
            <p className="f9-wk-dim f9-ads-wall-foot">
              {"The Ad Aggression Score comes from a public formula, not a black box. "}
              <Link to={AD_AGGRESSION_METHODOLOGY_PATH}>
                How this Ad Aggression Score is calculated — read the methodology
              </Link>
            </p>
          ) : null}
        </div>
      </section>

      {/* 5b. COMPETITOR-MONITORING SOURCE SECTIONS — issue #2200. The new
          sources (Google Ads, Google Search, LinkedIn, TikTok, subdomains,
          hiring) render after the existing Meta block, in a fixed order,
          each gated by a live claim row AND a stored snapshot. Missing
          sources omit entirely (no placeholder). The block renders nothing
          when no live source has a snapshot. Read-only D1 reads; the public
          page never triggers a fetch to any provider. */}
      <BrandPageSourceSections snapshots={data.sourceSnapshots} />

      {/* 6. BRAND FAQ — rendered from the same array as the FAQPage JSON-LD
          so the visible copy can never drift from the structured data. Every
          answer is grounded in content the page already shows (the Ad
          Aggression Score card, the "Last checked" stamp, the verified-link
          labels, the Track CTA). Hidden on noindex pages and the cache-miss
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

      {/* 6a. ALSO TRACKED IN <CATEGORY> — issue #2298. The /ads pages were
          lateral dead-ends for category browsing: the "More tracked brands"
          cluster (6b) links 12 alphabetical siblings, but a buyer on
          /ads/nike.com had no quick path to the OTHER Sport & footwear brands
          specifically. This module links up to 6 same-category siblings, read
          from the SAME category source /brands uses
          (`brandCategoryForDomain` in ~/lib/brand-categories — never a second
          list), in stable alphabetical order, limited to brands with live
          /ads pages (the sitemap indexability signal — no soft-404 links).
          Omitted when no same-category sibling has a live /ads page. Same
          verifiedLinkCount > 0 gate as 6b (issue #1454): a thin page carries
          no internal-link block. It never invents a brand. */}
      {data.verifiedLinkCount > 0 &&
      data.categorySiblings &&
      data.categorySiblings.links.length > 0 ? (
        <section className="ld-quiet" id="also-tracked-in-category">
          <div className="ld-section-head">
            <span className="ld-kicker">Public brand pages</span>
            <h2>{`Also tracked in ${data.categorySiblings.category}`}</h2>
            <p>
              More brands we track in the same category, each with its own indexable Meta ad page.
            </p>
          </div>
          <div
            className="ld-quiet-grid"
            aria-label={`Also tracked in ${data.categorySiblings.category}`}
          >
            {data.categorySiblings.links.map((link) => (
              <article key={link.domain}>
                <h3>
                  <Link to={link.path}>{link.name}</Link>
                </h3>
                <p>See {link.domain} ads on Five to Nine.</p>
              </article>
            ))}
          </div>
          {/* Same /brands hub link as the "More tracked brands" cluster so a
              visitor can always reach the full categorized list. */}
          <p className="ld-quiet-cta">
            <Link to="/brands">Browse all tracked brands →</Link>
          </p>
        </section>
      ) : null}

      {/* 6b. RELATED BRANDS — issue #1417. The /ads/:domain pages were
          orphans: none linked to any other /ads page, so a buyer who landed
          on /ads/nike.com could not find /ads/adidas.com without going back
          to search, and Google saw no internal link equity between brand
          pages. This section cross-links this page to a deterministic set of
          OTHER indexable brand pages (the current domain is always excluded)
          plus the /brands hub, so every sitemap /ads page carries at least
          one internal link to another /ads page. Since issue #2048 the
          cluster is >=10 siblings (RELATED_BRAND_LINK_COUNT) so the
          programmatic /ads cohort is a connected crawlable graph — rendered
          via <BrowseTrackedCompetitors> as the "More tracked brands" cluster.
          Hidden when there are no OTHER indexable brand pages (single-brand
          sitemap or a cache hiccup) OR when this page itself has zero
          verified-linked ads — the same combined conditional the
          BreadcrumbList honors (issue #1454): a populated page
          (verifiedLinkCount > 0) may carry both blocks, and a
          verifiedLinkCount = 0 page must carry NEITHER. It never invents a
          brand. */}
      {data.verifiedLinkCount > 0 && data.relatedBrands.length > 0 ? (
        <BrowseTrackedCompetitors links={data.relatedBrands} heading="More tracked brands" />
      ) : null}

      {/* 7. CLOSER */}
      <section className="f9-ads-closer">
        <div className="f9-container">
          <h2 className="f9-ads-closer-head">
            {closerHeadline(data, allBrandOwned, noneBrandOwned)}
            <span className="f9-ads-hl">Be the first to know.</span>
          </h2>
          <div className="f9-ads-closer-cta">
            {/* Issue #2051: the closer carries the same competitor prefill
                href as the hero CTA — identical labels must behave
                identically (judge finding, PR #2063). */}
            <Link className="f9-ads-watch-btn" to={trackSignupPath}>
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
      // The example is a teaching shell, not a real rerank output — tag it
      // as an ad_new so the now-required `eventType` is set everywhere a
      // BrandChangeEvent is constructed.
      eventType: "ad_new",
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

        <BrandOfferTimeline domain={data.domain} entries={data.offerTimelineEntries} timelineIndexable={data.timelineIndexable} />
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
