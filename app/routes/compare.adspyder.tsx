import { Form, Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import { Breadcrumbs } from "~/components/breadcrumbs";
import {
  Cite,
  CompareCitationsFooter,
  type CompareCitations,
  type CompareClaimCard,
} from "~/components/compare-citations";
import {
  canonicalLinks,
  faqPageJsonLd,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
  type FaqJsonLdEntry,
} from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";
import adspyderCitations from "~/data/compare/adspyder-citations.json";

const citations = adspyderCitations as CompareCitations;

const pageTitle = "Five to Nine vs AdSpyder";
const pageDescription =
  "AdSpyder is a low-cost ad-alert tool. Five to Nine is scheduled, source-backed Meta Ad Library and landing-page change proof.";

export const links: LinksFunction = () => canonicalLinks("/compare/adspyder");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: pageTitle,
    description: pageDescription,
    pathname: "/compare/adspyder",
  });

const adspyderStrengths: readonly CompareClaimCard[] = [
  {
    title: "A low listed price",
    detail:
      "AdSpyder's public plans are listed from $10 to $99 a month. That is a cheap way to get alerts when a competitor launches a new ad. Confirm current plans on AdSpyder's site.",
    sourceId: "adspyder-pricing",
  },
  {
    title: "New-ad alerts",
    detail:
      "Public copy says it alerts when competitors launch new ads, update creatives, or shift messaging, and that detections can land within hours.",
    sourceId: "adspyder-home",
  },
  {
    title: "Landing-page CTA and offer read",
    detail:
      "AdSpyder also advertises landing-page CTA and offer analysis. Treat that as a vendor claim until you have checked a real capture on your competitors.",
    sourceId: "adspyder-features",
  },
];

const adspyderCosts: readonly CompareClaimCard[] = [
  {
    title: "Diffs are unverified",
    detail:
      "The public materials describe alerts and analysis. Independent confirmation that AdSpyder stores a before/after of a specific offer or price change, with a source link, was not found. Do not assume that job is done.",
  },
  {
    title: "Alert volume is the cheap-tool risk",
    detail:
      "A $10–99 monitor that fires on every new ad can become the same noise problem buyers already complain about in this category. Five to Nine's job is the change, not a re-listing of everything running.",
  },
  {
    title: "No saved proof trail you can hand a client",
    detail:
      "If you need timestamped page text, the original source URL, and a screenshot when the capture includes one, that is the Five to Nine job. AdSpyder's listed price does not, by itself, prove that trail exists.",
  },
];

const fiveToNineAdds = [
  {
    theirs: "Change, not a new-ad ping",
    ours: "Paid plans check every 3–6 hours and compare each scan to the last one, so you hear when an offer, price, or CTA actually moved.",
  },
  {
    theirs: "Saved evidence",
    ours: "Confirmed changes are saved with the page text, the original source link, and a screenshot when the capture includes one, so the claim survives a closed tab.",
  },
  {
    theirs: "Honest labels",
    ours: "Results are marked live, recent, delayed, or sample. We do not present a stale snapshot as a fresh check.",
  },
] as const;

export const faqEntries: ReadonlyArray<FaqJsonLdEntry> = [
  {
    question: "How much does AdSpyder cost?",
    answer:
      "Public list prices as of August 2026 are published on AdSpyder's site. Confirm current plans there. The visible copy on this page cites those figures.",
  },
  {
    question: "Is Five to Nine an AdSpyder alternative?",
    answer:
      "AdSpyder is a low-cost ad-alert tool. Five to Nine is scheduled, source-backed proof of Meta Ad Library and landing-page changes. It is an alternative if you need the proof trail, not if you only want cheap new-ad pings.",
  },
  {
    question: "Does AdSpyder diff landing pages?",
    answer:
      "AdSpyder advertises landing-page CTA and offer analysis. Independent confirmation of a stored before/after with a source link was not found. Five to Nine's pages state only the capture and proof behavior we actually ship.",
  },
] as const;

export default function CompareAdspyderRoute() {
  const structuredFaq = faqPageJsonLd(faqEntries);

  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: pageTitle,
            description: pageDescription,
            pathname: "/compare/adspyder",
            comparedProductName: "AdSpyder",
          }),
        )}
      />
      <script {...jsonLdScriptProps(structuredFaq)} />
      <MarketingNav />
      <Breadcrumbs
        items={[
          { name: "Home", pathname: "/" },
          { name: "Competitor monitoring", pathname: "/competitor-monitoring" },
          { name: "AdSpyder", pathname: "/compare/adspyder" },
        ]}
      />

      <section className="ld-hero">
        <p className="ld-case">
          <span>{pageTitle}</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          AdSpyder is a $10–99 ad-alert tool. Five to Nine is change proof with a source link.
        </h1>
        <p className="ld-deck-copy">
          AdSpyder's public plans run from $10 to $99 a month and promise alerts when competitors
          launch new ads. That can be enough. Five to Nine is for the scheduled before and after,
          with a source link and a screenshot when the capture includes one. Competitor prices on this page are public list prices
          as of August 2026 — check the vendor's site for current plans.
        </p>

        <Form className="ld-command" method="get" action="/search" aria-label="Public search preview">
          <input
            aria-label="Competitor website"
            name="website"
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

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">Credit where due</span>
          <h2>What AdSpyder does well.</h2>
        </div>
        <div className="ld-quiet-grid">
          {adspyderStrengths.map((item) => (
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
          <h2>Where a cheap alert differs from proof.</h2>
        </div>
        <div className="ld-quiet-grid">
          {adspyderCosts.map((item) => (
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
          Paste a competitor website into the <Link to="/search">search preview</Link> — no account
          needed. Also see <Link to="/compare/foreplay-spyder">Five to Nine vs Foreplay Spyder</Link>{" "}
          and <Link to="/compare/meta-ad-library">checking the Meta Ad Library by hand</Link>.
          Questions? Email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>.
        </p>
      </section>

      <CompareCitationsFooter citations={citations} />

      <MarketingFooter />
    </main>
  );
}
