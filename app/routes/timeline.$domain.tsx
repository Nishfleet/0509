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

import { MarketingFooter } from "~/components/marketing-footer";
import { MarketingNav } from "~/components/marketing-nav";
import { OfferTimelineLedger } from "~/components/offer-timeline-ledger";
import { getOptionalCloudflareContext } from "~/lib/cloudflare-context";
import type { OfferLedgerEntry } from "~/lib/offer-timeline";
import { canonicalUrl, jsonLdScriptProps, publicSeoMeta, webPageJsonLd } from "~/lib/seo";

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
  noindex: boolean;
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

  const { isOfferTimelineShareEnabled, loadOfferTimeline } = await import(
    "~/lib/offer-timeline.server"
  );

  let loadFailed = false;
  let loaded: Awaited<ReturnType<typeof loadOfferTimeline>> = {
    entries: [],
    asOfState: null,
  };
  try {
    loaded = await loadOfferTimeline(env, { domain: brand.domain, asOf });
  } catch {
    loadFailed = true;
    loaded = { entries: [], asOfState: null };
  }

  // Retire path (issue #1309): a timeline with no stored snapshots is a
  // soft-404 "not stored yet" shell — the moat page that 83% of sitemap
  // brands used to 200 with brand chrome. When the D1 read SUCCEEDED and
  // returned zero rows (the table exists, the domain simply has no
  // captures), return 410 Gone so the shell never 200s. A transient D1
  // read FAILURE is different — the timeline might have entries once D1
  // recovers, so that degrades to the noindex shell below, never a 410.
  if (!loadFailed && loaded.entries.length === 0) {
    throw new Response("Gone", { status: 410 });
  }

  const canonicalPath = `/timeline/${brand.domain}`;
  const sharePath = asOf ? `${canonicalPath}?asOf=${asOf}` : canonicalPath;
  const shareUrl = asOf
    ? `${canonicalUrl(canonicalPath)}?asOf=${asOf}`
    : canonicalUrl(canonicalPath);
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
    noindex,
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
      ? `Dated offer states for ${loaderData.domain}: headline, CTA, and price, each with the stored screenshot and page text.`
      : `No stored offer timeline for ${loaderData.domain} yet.`;

  return [
    ...publicSeoMeta({ title, description, pathname: loaderData.canonicalPath }),
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
      : `We have not stored an offer timeline for ${data.domain} yet.`;

  return (
    <main className="f9-home f9-ads-page f9-timeline-page">
      {!data.noindex ? (
        <script
          {...jsonLdScriptProps(
            webPageJsonLd({
              name: `${data.brandName} offer timeline | Five to Nine`,
              description: `Dated offer states for ${data.domain}.`,
              pathname: data.canonicalPath,
              aboutName: data.brandName,
            }),
          )}
        />
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
            A dated ledger of what this competitor's landing page said: headline, CTA, and
            price, with the screenshot and page text for each state.
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
                    {!data.asOfState.screenshotHref &&
                    !data.asOfState.pageTextHref &&
                    data.asOfState.evidenceNote
                      ? data.asOfState.evidenceNote
                      : null}
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

      <section className="f9-timeline-section" aria-labelledby="offer-timeline-ledger-title">
        <div className="f9-container">
          <h2 className="f9-timeline-section-title" id="offer-timeline-ledger-title">
            Dated offer states
          </h2>
          {data.entries.length > 0 ? (
            <OfferTimelineLedger entries={data.entries} />
          ) : (
            <p className="f9-timeline-empty">
              No stored snapshots yet. Once monitoring captures this landing page, the
              dated ledger lands here.
            </p>
          )}
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
