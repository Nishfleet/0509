/**
 * /timeline/:domain — public Offer Timeline per tracked competitor.
 *
 * ZERO-COST CONSTRAINT: this page renders ONLY from stored
 * `landing_page_snapshot` rows (bounded D1 reads). A public request must
 * NEVER trigger live scraping, Browser Rendering, or any other paid
 * operation. The corpus is written by monitoring (issue 952).
 *
 * The URL itself is the share link: it renders logged out. Share-link
 * chrome (the copyable URL) can be switched off with
 * PUBLIC_OFFER_TIMELINE_SHARE="0".
 *
 * `?asOf=YYYY-MM-DD` returns the offer state on that UTC date.
 */

import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import { ArchiveLedger } from "~/components/archive-ledger";
import { MarketingFooter } from "~/components/marketing-footer";
import { MarketingNav } from "~/components/marketing-nav";
import { OfferTimelineLedger } from "~/components/offer-timeline-ledger";
import type { DomainArchive } from "~/lib/archive";
import { getOptionalCloudflareContext } from "~/lib/cloudflare-context";
import type { OfferLedgerEntry } from "~/lib/offer-timeline";
import type { TimelineSourceEvent } from "~/components/brand-page/timeline-source-events.server";
import { formatWatchEventTypeLabel } from "~/lib/watch-event-display";
import {
  breadcrumbJsonLd,
  canonicalUrl,
  jsonLdScriptProps,
  offerTimelineDatasetJsonLd,
  publicSeoMeta,
  timelineSocialCardUrl,
  webPageJsonLd,
} from "~/lib/seo";
import "../marketing.css";

export interface OfferTimelineLoaderData {
  domain: string;
  brandName: string;
  canonicalPath: string;
  sharePath: string;
  shareUrl: string;
  shareEnabled: boolean;
  asOf: string | null;
  asOfState: OfferLedgerEntry | null;
  entries: OfferLedgerEntry[];
  /** The public proof archive (issue #2173) — public-ad facts only. */
  archive: DomainArchive;
  /**
   * Issue #2200 — recent events from the new competitor-monitoring source
   * diffs (a new Google creative, a new LinkedIn ad, a new public subdomain,
   * roles opened, etc.), projected from the same watch_event stream the
   * offer timeline reads. Only events tagged with a LIVE source's
   * `sourceId` surface. Empty when no watchlist tracks the domain, no live
   * source exists, or no source event landed — the section hides.
   */
  sourceEvents: TimelineSourceEvent[];
  noindex: boolean;
  /**
   * True when the ledger is empty but this domain is a tracked, sitemap-listed
   * brand (issue #2021): the page renders an honest "collecting" 200 instead
   * of the retire 410, so the moat surface stays discoverable for the whole
   * tracked /ads cohort while captures accumulate.
   */
  collecting: boolean;
}

export async function loader({
  context,
  params,
  request,
}: LoaderFunctionArgs): Promise<OfferTimelineLoaderData> {
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

  const { parseAsOfDate } = await import("~/lib/offer-timeline");
  const asOf = parseAsOfDate(new URL(request.url).searchParams.get("asOf"));

  const { isOfferTimelineShareEnabled } = await import(
    "~/lib/offer-timeline.server"
  );
  const { emptyDomainArchive } = await import("~/lib/archive");
  const { loadPublicDomainArchive } = await import("~/lib/archive.server");

  let loadFailed = false;
  let loaded: Awaited<ReturnType<typeof loadPublicDomainArchive>> = {
    entries: [],
    asOfState: null,
    archive: emptyDomainArchive(brand.domain, new Date()),
  };
  try {
    loaded = await loadPublicDomainArchive(env, { domain: brand.domain, asOf });
  } catch {
    loadFailed = true;
    loaded = {
      entries: [],
      asOfState: null,
      archive: emptyDomainArchive(brand.domain, new Date()),
    };
  }

  // Retire path (issue #1309): a timeline with no stored snapshots is a
  // soft-404 "not stored yet" shell. Issue #2021 narrows the 410: a tracked,
  // indexable /ads brand (or a capture-backed timeline domain) renders an
  // honest "collecting — no offer states recorded yet" 200 so the moat stays
  // discoverable for the whole tracked cohort. Issue #2881: those zero-state
  // pages are robots-noindex and are never listed in sitemap.xml or /llms.txt
  // (BET 5 "no page ships empty") — the collecting 200 is a human-facing
  // landing, not an indexed acquisition page. An UNLISTED domain with an
  // empty ledger keeps the 410 Gone (never 200 with brand chrome for a
  // domain we do not track). A transient D1 read FAILURE is still
  // different — the timeline might have entries once D1 recovers, so that
  // degrades to the noindex shell below, never a 410.
  let collecting = false;
  if (!loadFailed && loaded.entries.length === 0) {
    const { loadIndexableBrandPageEntries, loadIndexableTimelineEntries, timelineSitemapEntries } = await import(
      "~/lib/sitemap.server"
    );
    let listed = false;
    try {
      const [brandEntries, timelineEntries] = await Promise.all([
        loadIndexableBrandPageEntries(env),
        loadIndexableTimelineEntries(env),
      ]);
      // The tracked-cohort signal: an indexable /ads/:domain page (the brand
      // is monitored), OR a domain the capture-backed timeline set lists (it
      // had a proof-complete ledger at sitemap time — a zero-entry read here
      // is transient). Collecting entries no longer exist in the sitemap set
      // (issue #2881), so timelineSitemapEntries is capture-backed only.
      listed =
        brandEntries.some((entry) => entry.path === `/ads/${brand.domain}`) ||
        timelineSitemapEntries(timelineEntries).some(
          (entry) => entry.path === `/timeline/${brand.domain}`,
        );
    } catch {
      // Sitemap read hiccup: degrade to the retire 410, never a 500.
      listed = false;
    }
    if (listed) {
      collecting = true;
    } else {
      throw Response.json(
        { domain: brand.domain, brandName: brand.displayName },
        { status: 410, statusText: "Gone" },
      );
    }
  }

  // Issue #2200 — recent source-diff events (new Google creative, new
  // LinkedIn ad, new public subdomain, roles opened, etc.) from the same
  // watch_event stream, gated to live sources. Read-only; a hiccup degrades
  // to [] (the section hides) rather than 500ing the page.
  let sourceEvents: TimelineSourceEvent[] = [];
  try {
    const { loadTimelineSourceEvents } = await import(
      "~/components/brand-page/timeline-source-events.server"
    );
    sourceEvents = await loadTimelineSourceEvents(env, brand.domain);
  } catch (error) {
    console.warn("Timeline source events read failed; hiding the section.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    sourceEvents = [];
  }

  const canonicalPath = `/timeline/${brand.domain}`;
  const sharePath = asOf ? `${canonicalPath}?asOf=${asOf}` : canonicalPath;
  const shareUrl = asOf
    ? `${canonicalUrl(canonicalPath)}?asOf=${asOf}`
    : canonicalUrl(canonicalPath);
  // Issue #2881: a zero-state timeline is always noindex — collecting pages
  // render an honest 200 but are never an indexed acquisition surface.
  const noindex = loaded.entries.length === 0;

  return {
    domain: brand.domain,
    brandName: brand.displayName,
    canonicalPath,
    sharePath,
    shareUrl,
    shareEnabled: isOfferTimelineShareEnabled(env),
    asOf,
    asOfState: loaded.asOfState,
    entries: loaded.entries,
    archive: loaded.archive,
    sourceEvents,
    noindex,
    collecting,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  if (!loaderData) {
    return [
      { title: "Offer timeline | Five to Nine" },
      { name: "robots", content: "noindex" },
    ];
  }

  const title = `${loaderData.brandName} offer timeline | Five to Nine`;
  const description =
    loaderData.entries.length > 0
      ? `Dated offer states for ${loaderData.domain}: headline, CTA, and price, with page text and a screenshot when we stored one.`
      : loaderData.collecting
        ? `Collecting offer states for ${loaderData.domain} — no offer states recorded yet; the dated ledger lands here as monitoring captures land.`
        : `No stored offer timeline for ${loaderData.domain} yet.`;

  // Per-domain social card (issue #2029): share/preview of a timeline names
  // the brand instead of the site-wide generic og-image.png, reusing the same
  // generator + serving path the /ads/:domain cards already use.
  const ogImageUrl = timelineSocialCardUrl(loaderData.domain, loaderData.brandName);
  const ogImageAlt = `${loaderData.brandName} offer timeline — what their landing page said, with proof | Five to Nine`;

  return [
    ...publicSeoMeta({
      title,
      description,
      pathname: loaderData.canonicalPath,
      ogImageUrl,
      ogImageAlt,
    }),
    { tagName: "link", rel: "canonical", href: canonicalUrl(loaderData.canonicalPath) },
    ...(loaderData.noindex ? [{ name: "robots", content: "noindex" }] : []),
  ];
};

export default function OfferTimelineRoute() {
  const data = useLoaderData<typeof loader>();
  const signupPath = `/auth/signup?redirectTo=${encodeURIComponent(`/app?website=${encodeURIComponent(data.domain)}#setup-checklist`)}`;
  const adsPath = `/ads/${encodeURIComponent(data.domain)}`;
  const pageTitle =
    data.entries.length > 0
      ? `Every offer ${data.brandName} has run since we started watching.`
      : data.collecting
        ? `We are collecting offer states for ${data.domain}.`
        : `We have not stored an offer timeline for ${data.domain} yet.`;

  return (
    <main className="f9-home f9-ads-page f9-timeline-page">
      {!data.noindex ? (
        <>
          <script
            {...jsonLdScriptProps(
              webPageJsonLd({
                name: `${data.brandName} offer timeline | Five to Nine`,
                description: data.collecting
                  ? `Collecting offer states for ${data.domain} — no offer states recorded yet.`
                  : `Dated offer states for ${data.domain}.`,
                pathname: data.canonicalPath,
                aboutName: data.brandName,
              }),
            )}
          />
          <script
            {...jsonLdScriptProps(
              breadcrumbJsonLd({
                items: [
                  { name: "Home", pathname: "/" },
                  {
                    name: `${data.brandName} offer timeline`,
                    pathname: data.canonicalPath,
                  },
                ],
              }),
            )}
          />
          {/*
           * Dataset JSON-LD (issue 964): the timeline is the citable,
           * uncopyable change-ledger asset. datePublished/dateModified come
           * from the first and last stored snapshot timestamps the page
           * already renders; license is the operating terms the footer
           * links; distribution points answer engines at this same URL as
           * HTML. Emitted only on indexable timelines — a noindex shell
           * never carries it.
           */}
          {data.entries.length > 0 ? (
            <script
              {...jsonLdScriptProps(
                offerTimelineDatasetJsonLd({
                  brandName: data.brandName,
                  domain: data.domain,
                  description: `Dated offer states for ${data.domain}: headline, CTA, and price, with page text and a screenshot when we stored one.`,
                  pathname: data.canonicalPath,
                  datePublished:
                    data.entries.length > 0
                      ? data.entries[0]?.capturedAt ?? null
                      : null,
                  dateModified:
                    data.entries.length > 0
                      ? data.entries[data.entries.length - 1]?.capturedAt ?? null
                      : null,
                }),
              )}
            />
          ) : null}
        </>
      ) : null}
      <MarketingNav />

      <section className="f9-ads-hero" aria-labelledby="offer-timeline-title">
        <div className="f9-container">
          <p className="f9-ads-eyebrow">
            <span aria-hidden="true" className="f9-ads-dot-live" />
            {`Offer timeline · ${data.domain}`}
          </p>
          <h1 className="f9-ads-headline" id="offer-timeline-title">
            {pageTitle}
          </h1>
          <p className="f9-ads-subline">
            {data.collecting
              ? "We are collecting this competitor's landing page now — no dated offer states recorded yet; the dated ledger lands here as monitoring captures land."
              : "A dated ledger of what this competitor's landing page said: headline, CTA, and price, with page text and a screenshot when we stored one."}
          </p>

          <form className="f9-timeline-asof" method="get" action={data.canonicalPath}>
            <label htmlFor="offer-timeline-asof">As of</label>
            <input
              id="offer-timeline-asof"
              type="date"
              name="asOf"
              defaultValue={data.asOf ?? ""}
            />
            <button className="f9-ads-watch-btn" type="submit">
              Show offer
            </button>
          </form>

          {data.asOf ? (
            <div className="f9-timeline-asof-result" data-as-of={data.asOf}>
              <h2>{`As of ${data.asOf}`}</h2>
              {data.asOfState ? (
                <>
                  <p>
                    {`${data.asOfState.headline}`}
                    {data.asOfState.ctaText ? ` · CTA: ${data.asOfState.ctaText}` : ""}
                    {data.asOfState.priceText ? ` · ${data.asOfState.priceText}` : ""}
                  </p>
                  <p className="f9-timeline-receipts">
                    {data.asOfState.screenshotHref ? (
                      <a href={data.asOfState.screenshotHref} rel="noreferrer">
                        Screenshot
                      </a>
                    ) : null}
                    {data.asOfState.pageTextHref ? (
                      <a href={data.asOfState.pageTextHref} rel="noreferrer">
                        Page text
                      </a>
                    ) : null}
                  </p>
                </>
              ) : (
                <p>No offer on record yet as of that date.</p>
              )}
            </div>
          ) : null}

          {data.shareEnabled ? (
            <p className="f9-timeline-share">
              <label htmlFor="offer-timeline-share-url">Share this timeline</label>
              <input
                id="offer-timeline-share-url"
                type="text"
                readOnly
                value={data.shareUrl}
              />
            </p>
          ) : null}

          <p className="f9-timeline-also">
            <Link to={adsPath}>{`Meta ads for ${data.domain}`}</Link>
            {" · "}
            <Link to={signupPath}>{`Watch ${data.domain}`}</Link>
          </p>
        </div>
      </section>

      <section className="f9-timeline-section" aria-labelledby="offer-timeline-archive-title">
        <div className="f9-container">
          {/*
           * The proof archive (issue #2173): every captured change with its
           * change mark, #1387 criticality band, capture method and receipts,
           * plus the month's deterministic rollup, per-ad tenure and the
           * per-page offer series. Gaps in capture render as gaps.
           */}
          <ArchiveLedger archive={data.archive} headingId="offer-timeline-archive-title" />
        </div>
      </section>

      <section className="f9-timeline-section" aria-labelledby="offer-timeline-ledger-title">
        <div className="f9-container">
          <h2 className="f9-timeline-section-title" id="offer-timeline-ledger-title">
            Dated offer states
          </h2>
          {data.entries.length > 0 ? (
            <OfferTimelineLedger entries={data.entries} />
          ) : (
            <p className="f9-timeline-empty">
              {data.collecting
                ? "Collecting — no offer states recorded yet. Once monitoring captures this landing page, the dated ledger lands here."
                : "No stored snapshots yet. Once monitoring captures this landing page, the dated ledger lands here."}
            </p>
          )}
        </div>
      </section>

      {/*
       * Issue #2200 — competitor-monitoring source events. Recent diffs from
       * the new sources (a new Google creative, a new LinkedIn ad, a new
       * public subdomain, roles opened, etc.) projected from the same
       * watch_event stream, gated to live sources. Same public projection
       * shape as the /ads "changed in the last 7 days" strip: event type +
       * change mark + capture date + the source label. No account data.
       * Hidden when empty (never an empty card).
       */}
      {(data.sourceEvents ?? []).length > 0 ? (
        <section className="f9-timeline-section" aria-labelledby="offer-timeline-source-events-title">
          <div className="f9-container">
            <h2 className="f9-timeline-section-title" id="offer-timeline-source-events-title">
              Recent source changes
            </h2>
            <ul className="f9-quiet-list" data-testid="timeline-source-events">
              {data.sourceEvents.map((event, index) => (
                <li
                  key={`${event.sourceId}:${event.eventType}:${event.capturedAt}:${index}`}
                  className="f9-quiet-list-item"
                >
                  <span className="f9-quiet-list-copy">
                    {`${event.sourceLabel} · ${formatWatchEventTypeLabel(event.eventType)}`}
                    {event.changeMark ? (
                      <>
                        {" — "}
                        <s>{event.changeMark.from}</s>
                        <span aria-hidden="true"> → </span>
                        <ins>{event.changeMark.to}</ins>
                      </>
                    ) : null}
                    {` · captured ${formatTimelineSourceDate(event.capturedAt)}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <MarketingFooter />
    </main>
  );
}

const TIMELINE_SOURCE_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "UTC",
});

function formatTimelineSourceDate(iso: string): string {
  try {
    return TIMELINE_SOURCE_DATE_FORMATTER.format(new Date(iso));
  } catch {
    return iso;
  }
}
