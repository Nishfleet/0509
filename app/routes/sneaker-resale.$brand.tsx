/**
 * /sneaker-resale/:brand — indexable per-brand cluster pages (issue #3087).
 *
 * The sneaker below-retail cluster is the only market signal with persistent
 * multi-source outside demand, and until #3087 the whole landing surface for
 * it was the single /sneaker-resale hub. Someone searching the demand
 * directly ("nike below retail", "stockx resale trend") had nowhere to land.
 * Each path here is a dated, honest cluster page for one of the four brands
 * the hub already links: nike, stockx, footlocker, jdsports. Unknown slugs
 * 404 — the page set is exactly the brands whose /ads/:domain surfaces are
 * live and linked by the hub (verified 2026-09-11), pinning the exact set.
 *
 * SEO contract (issue #3087 acceptance): each page canonicals to the
 * English page only and does NOT join the locale hreflang cluster that the
 * #2962 fix handles for /sneaker-resale. Copy reuses the hub's voice and
 * cites the same dated public sources as the hub — nothing invented.
 */

import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { MarketingFooter } from "~/components/marketing-footer";
import {
  sneakerResaleBrandPage,
  sneakerResaleBrandPages,
  sneakerResaleBrandPath,
  sneakerResaleBrandSignalAsOf,
  sneakerResaleBrandSources,
  type SneakerResaleBrandPageCopy,
} from "~/lib/sneaker-resale-brand-pages";
import { sneakerResaleSignupPath } from "~/lib/locale-markets";
import { canonicalUrl, jsonLdScriptProps, publicSeoMeta, webPageJsonLd } from "~/lib/seo";

interface BrandPageLoaderData {
  page: SneakerResaleBrandPageCopy;
}


export async function loader({
  context,
  request,
  params,
}: LoaderFunctionArgs): Promise<BrandPageLoaderData> {
  const page = sneakerResaleBrandPage(params.brand ?? "");
  if (!page) {
    throw new Response("Not Found", { status: 404 });
  }

  // Same funnel-view emission the /sneaker-resale hub uses for EN — these
  // pages are part of the same visit funnel, so the measurement matches
  // across the cluster.
  try {
    const { getEnv } = await import("~/lib/context.server");
    const { emitFunnelLocaleSegmentView } = await import("~/lib/funnel-measurement.server");
    emitFunnelLocaleSegmentView(getEnv(context), request, "en");
  } catch (error) {
    console.warn("Sneaker-resale brand funnel view emission failed; skipping.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }

  return { page };
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) {
    return [
      { title: "Page not found | Five to Nine" },
      { name: "robots", content: "noindex" },
    ];
  }
  // Canonical to the English page only (issue #3087): these brand pages do
  // NOT join the locale hreflang cluster the #2962 fix handles for the hub.
  // links() cannot read route params in this router version, so the canonical
  // ships as a meta-descriptor link (mirror /brands/:category).
  return [
    ...publicSeoMeta({
      title: `${data.page.name} below retail, tracked with proof | Five to Nine`,
      description: `Where the ${data.page.name} below-retail demand is visible and what the saved ${data.page.domain} ads actually show — screenshots with dates, not a mood-board.`,
      pathname: sneakerResaleBrandPath(data.page.slug),
      ogLocale: "en_US",
    }),
    { tagName: "link", rel: "canonical", href: canonicalUrl(sneakerResaleBrandPath(data.page.slug)) },
  ];
};

export default function SneakerResaleBrandRoute() {
  const data = useLoaderData<BrandPageLoaderData>();
  const sources = sneakerResaleBrandSources();
  const signalAsOf = sneakerResaleBrandSignalAsOf();
  const siblings = sneakerResaleBrandPages().filter((page) => page.slug !== data.page.slug);

  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: `${data.page.name} below retail, tracked with proof`,
            description: `Where the ${data.page.name} below-retail demand is visible and what the saved ${data.page.domain} ads actually show.`,
            pathname: sneakerResaleBrandPath(data.page.slug),
          }),
        )}
      />
      <MarketingNav />
      <Breadcrumbs
        items={[
          { name: "Home", pathname: "/" },
          { name: "Sneaker resale", pathname: "/sneaker-resale" },
          { name: data.page.name, pathname: sneakerResaleBrandPath(data.page.slug) },
        ]}
      />

      <section className="ld-hero">
        <p className="ld-case">
          <span>Sneaker resale · {data.page.name}</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          {data.page.name} below retail — the demand, and the ads we saved.
        </h1>
        <p className="ld-deck-copy">{data.page.signal}</p>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">Sources</span>
          <h2>Where the signal comes from.</h2>
          <p className="ld-deck-copy">
            The dated public sources behind the below-retail cluster, as of
            signal {signalAsOf}. We link them; we do not rehost them.
          </p>
        </div>
        <ul className="ld-swing-sources">
          {sources.map((source) => (
            <li key={source.url}>
              <a href={source.url} rel="noreferrer" target="_blank">
                {source.label}
              </a>{" "}
              <time dateTime={source.publishedIso}>({source.publishedIso})</time>
            </li>
          ))}
        </ul>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">What we have on file</span>
          <h2>
            The {data.page.name} wall on{" "}
            <Link to={`/ads/${data.page.domain}`}>/ads/{data.page.domain}</Link>.
          </h2>
        </div>
        <div className="ld-quiet-grid">
          {data.page.proof.map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">Honest limits</span>
          <h2>What this page does not pretend.</h2>
        </div>
        <div className="ld-quiet-grid">
          <article>
            <h3>The demand sources name the market, not every seller.</h3>
            <p>
              The cited thread and report are about sneaker resale demand in
              general. One of them is a Nike-specific thread; the rest of this
              page links what we can actually show — the saved{" "}
              {data.page.domain} captures.
            </p>
          </article>
          <article>
            <h3>The hub carries the detail.</h3>
            <p>
              This page is one entry in the below-retail cluster. The{" "}
              <Link to="/sneaker-resale">sneaker-resale hub</Link> names the
              movers, the method, and the honest limits of the whole signal.
            </p>
          </article>
        </div>
      </section>

      <section className="ld-quiet" aria-label="More brands in this cluster">
        <ul className="ld-brand-links">
          {siblings.map((page) => (
            <li key={page.domain}>
              <Link to={sneakerResaleBrandPath(page.slug)}>
                <strong>{page.name}</strong>
                <span>{page.domain}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="ld-final">
        <div className="ld-migration-cta">
          <div>
            <span className="ld-kicker">Keep the watch</span>
            <h2>Pricing a restock? Skip the Ad Library tab.</h2>
            <p>
              Five to Nine saves {data.page.name}'s ads and landing pages daily,
              with timestamps. Set it up once, look back on any morning.
            </p>
          </div>
          <a
            className="ld-cta-button"
            href={sneakerResaleSignupPath("en")}
          >
            Try it free, no account <span aria-hidden="true">→</span>
          </a>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
