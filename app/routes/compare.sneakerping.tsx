import { Form, Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { LiveBrandProof } from "~/components/live-brand-proof";
import {
  Cite,
  CompareCitationsFooter,
  type CompareCitations,
  type CompareClaimCard,
} from "~/components/compare-citations";
import {
  canonicalLinks,
  compareSocialCardUrl,
  faqPageJsonLd,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
  type FaqJsonLdEntry,
} from "~/lib/seo";
import { FREE_PREVIEW_SEARCH_DOMAIN, LIVE_BRAND_PROOF_DOMAIN } from "~/lib/demo-brand-pages";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";
import sneakerpingCitations from "~/data/compare/sneakerping-citations.json";

const citations = sneakerpingCitations as CompareCitations;

const pageTitle = "Five to Nine vs SneakerPing";
const pageDescription =
  "SneakerPing pings sneaker buyers the moment a tracked pair drops to their target price across 40+ online stores. Five to Nine is scheduled, source-backed Meta Ad Library and landing-page change proof.";

export const links: LinksFunction = () => canonicalLinks("/compare/sneakerping");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: pageTitle,
    description: pageDescription,
    pathname: "/compare/sneakerping",
    ogImageUrl: compareSocialCardUrl("sneakerping"),
    ogImageAlt: "Five to Nine vs SneakerPing comparison card",
  });

const sneakerpingStrengths: readonly CompareClaimCard[] = [
  {
    title: "A focused, honest job: price alerts",
    detail:
      "SneakerPing's public pages describe one job: watch StockX, GOAT, eBay, and 40+ online stores and ping you the moment a tracked pair drops to your target price.",
    sourceId: "sneakerping-home",
  },
  {
    title: "A published market study",
    detail:
      "SneakerPing published a study of 3,538 sneaker releases between August 2024 and August 2026: 59.5% most recently sold below retail, with a median 10.6% under retail, figures as of 18 August 2026.",
    sourceId: "sneakerping-study",
  },
  {
    title: "A free way in",
    detail:
      "The free tier watches 5 pairs with no credit card, which is a real way to try the workflow before paying. Confirm current plans on SneakerPing's site.",
    sourceId: "sneakerping-home",
  },
];

const sneakerpingDifferences: readonly CompareClaimCard[] = [
  {
    title: "Pings, not proofs",
    detail:
      "SneakerPing's described job ends at the ping: price, availability, and forecasts. It does not claim to save the before-and-after of a competitor's ads or landing pages. Five to Nine's whole job is the saved, source-linked before-and-after.",
  },
  {
    title: "A shopper's tool, not a marketer's",
    detail:
      "SneakerPing watches resale marketplaces for a buyer hunting a pair. Five to Nine reads the public Meta Ad Library and live landing pages for a team watching competitors.",
  },
  {
    title: "Forecasts, not change history",
    detail:
      "SneakerPing forecasts prices 7 to 365 days out. Five to Nine shows what actually changed, when, with page text and a screenshot when the capture includes one.",
    sourceId: "sneakerping-home",
  },
];

const fiveToNineAdds = [
  {
    theirs: "Price alerts across 40+ stores",
    ours: "You paste a competitor website. We read the public Meta Ad Library and the live landing page from that domain, then watch them on a schedule. You do not have to hunt every pair first.",
  },
  {
    theirs: "Price predictions and forecasts",
    ours: "We look for offer, price, CTA, and hook changes, then save the page text, the original source link, and a screenshot when the capture includes one. Forecasts inform strategy; change proof closes the loop on what actually moved.",
  },
  {
    theirs: "A sneaker-shopping watchlist",
    ours: "Results are marked live, recent, delayed, or sample. We do not present a stale snapshot as a fresh check, whichever vendor you came from.",
  },
] as const;

export const faqEntries: ReadonlyArray<FaqJsonLdEntry> = [
  {
    question: "How much does SneakerPing cost?",
    answer:
      "SneakerPing's own homepage states a free tier that watches 5 pairs with no credit card, and paid plans behind a 7-day free trial. Confirm current plans on SneakerPing's site.",
  },
  {
    question: "Is Five to Nine a SneakerPing alternative?",
    answer:
      "SneakerPing alerts sneaker buyers when a tracked pair drops to their target price across 40+ online stores. Five to Nine is scheduled, source-backed Meta Ad Library and landing-page change monitoring that starts from a domain paste. It is the alternative if you want before-and-after proof of what a competitor changed, not a shopping alert.",
  },
  {
    question: "What does Five to Nine add?",
    answer:
      "Paid plans check watched competitors every 3–6 hours, diff offer, price, CTA, and hook fields, and save page text, the original source link, and a screenshot when the capture includes one. Status is labeled live, recent, delayed, or sample.",
  },
] as const;

export default function CompareSneakerpingRoute() {
  const structuredFaq = faqPageJsonLd(faqEntries);

  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: pageTitle,
            description: pageDescription,
            pathname: "/compare/sneakerping",
            comparedProductName: "SneakerPing",
          }),
        )}
      />
      <script {...jsonLdScriptProps(structuredFaq)} />
      <MarketingNav />
      <Breadcrumbs
        items={[
          { name: "Home", pathname: "/" },
          { name: "Competitor monitoring", pathname: "/competitor-monitoring" },
          { name: "SneakerPing", pathname: "/compare/sneakerping" },
        ]}
      />

      <section className="ld-hero">
        <p className="ld-case">
          <span>{pageTitle}</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          SneakerPing pings you when the price drops. Five to Nine proves what changed.
        </h1>
        <p className="ld-deck-copy">
          SneakerPing is a sneaker price-alert service: set a target price, and it watches StockX,
          GOAT, eBay, and 40+ online stores and pings you when a pair drops into range — with a free
          tier that tracks 5 pairs. Its published study prices 3,538 recent sneaker releases, with
          59.5% trading below retail. Five to Nine does a different job: source-backed Meta Ad
          Library and landing-page change proof for teams watching competitors.
        </p>

        <Form className="ld-command" method="get" action="/search" aria-label="Public search preview">
          <input
            aria-label="Competitor website"
            name="website"
            defaultValue={FREE_PREVIEW_SEARCH_DOMAIN}
            placeholder="paste-a-competitor-website.com…"
            type="text"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
          />
          <button type="submit">
            Try it free, no account <span aria-hidden="true">→</span>
          </button>
        </Form>
      </section>

      <section className="ld-quiet" data-source-url={citations.sources[0].href}>
        <div className="ld-section-head">
          <span className="ld-kicker">Credit where due</span>
          <h2>What SneakerPing does well.</h2>
        </div>
        <div className="ld-quiet-grid">
          {sneakerpingStrengths.map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>
                {item.detail}
                {item.sourceId ? <Cite citations={citations} id={item.sourceId} /> : null}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">The honest trade-off</span>
          <h2>Where the products differ.</h2>
        </div>
        <div className="ld-quiet-grid">
          {sneakerpingDifferences.map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>
                {item.detail}
                {item.sourceId ? <Cite citations={citations} id={item.sourceId} /> : null}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-how">
        <h2>What Five to Nine adds on top.</h2>
        <div className="ld-how-grid">
          {fiveToNineAdds.map((row, index) => (
            <article key={row.theirs}>
              <span className="ld-step">{String(index + 1).padStart(2, "0")}</span>
              <h3>{row.theirs}</h3>
              <p>{row.ours}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-final">
        <h2>
          Start with the free preview <span aria-hidden="true">→</span>
        </h2>
        <p className="ld-pricing-note">
          Paste a competitor website into the{" "}
          <Link to={`/search?website=${FREE_PREVIEW_SEARCH_DOMAIN}`}>search preview</Link> — no account
          needed. Also see <Link to="/compare/meta-ad-library">checking the Meta Ad Library by hand</Link> and{" "}
          <Link to="/compare/keeptabz">Five to Nine vs KeepTabz</Link>. Questions?
          Email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>.
        </p>
      </section>

      <LiveBrandProof domain={LIVE_BRAND_PROOF_DOMAIN} />

      <CompareCitationsFooter citations={citations} />

      <MarketingFooter />
    </main>
  );
}
