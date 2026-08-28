import { Form, Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
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
import panoramataCitations from "~/data/compare/panoramata-citations.json";

const citations = panoramataCitations as CompareCitations;

const pageTitle = "Five to Nine vs Panoramata";
const pageDescription =
  "Panoramata monitors competitor ads and pages on listed paid plans. Five to Nine starts from a domain paste and keeps source-backed proof of what changed.";

export const links: LinksFunction = () => canonicalLinks("/compare/panoramata");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: pageTitle,
    description: pageDescription,
    pathname: "/compare/panoramata",
  });

const panoramataStrengths: readonly CompareClaimCard[] = [
  {
    title: "Ads and pages in one product",
    detail:
      "Panoramata combines competitor ads, landing pages (desktop and mobile), website changes, and a versioned screenshot archive. That is a real ads-plus-pages product, not a generic URL watcher.",
    sourceId: "panoramata-website-changes",
  },
  {
    title: "History you can scroll",
    detail:
      "Public plans list a 6-month archive on Startup and unlimited history on Professional. Side-by-side screenshot comparison is part of the product.",
    sourceId: "panoramata-pricing",
  },
  {
    title: "Broader than ads",
    detail:
      "Panoramata also tracks marketing emails, SMS, and flows on higher tiers. Five to Nine does not cover those channels.",
    sourceId: "panoramata-home",
  },
];

const panoramataCosts: readonly CompareClaimCard[] = [
  {
    title: "A high floor for a solo operator",
    detail:
      "Public list prices run from €99 a month (Startup, 20 competitors) to €379 (Advanced). Professional is listed at €149. Confirm current plans on Panoramata's site.",
    sourceId: "panoramata-pricing",
  },
  {
    title: "Weekly-first alerts",
    detail:
      "The published rhythm is a weekly email summary, with an optional daily. Five to Nine's paid plans check every 3–6 hours and send a digest on a daily or weekly cadence.",
  },
  {
    title: "No public MCP on listed plans",
    detail:
      "Panoramata's public materials put API access on Enterprise. Five to Nine's customer API and MCP exist on Agency; they are not claimed as a free-tier feature here.",
  },
];

const fiveToNineAdds = [
  {
    theirs: "Paste a domain, not a list of URLs",
    ours: "You paste a competitor website. We read the public Meta Ad Library and the live landing page from that domain. You do not have to hunt every page URL first.",
  },
  {
    theirs: "Diffs on the commercial fields",
    ours: "We look for offer, price, CTA, and hook changes, then save the page text, the original source link, and a screenshot when the capture includes one. Panoramata diffs pages; we try to name the commercial change.",
  },
  {
    theirs: "Honest status labels",
    ours: "Results are marked live, recent, delayed, or sample. We do not present a stale snapshot as a fresh check.",
  },
] as const;

export const faqEntries: ReadonlyArray<FaqJsonLdEntry> = [
  {
    question: "How much does Panoramata cost?",
    answer:
      "Public list prices as of August 2026 are published on Panoramata's site, from the Startup plan through Advanced. Confirm current plans there. The visible copy on this page cites those figures.",
  },
  {
    question: "Is Five to Nine a Panoramata alternative?",
    answer:
      "Panoramata is a broader ads-plus-pages-plus-email monitor with a high monthly floor. Five to Nine is source-backed Meta Ad Library and landing-page change monitoring that starts from a domain paste. It is an alternative if that narrower job is what you need, not if you want email and SMS capture.",
  },
  {
    question: "What does Five to Nine add?",
    answer:
      "Paid plans check watched competitors every 3–6 hours, diff offer, price, CTA, and hook fields, and save page text, the original source link, and a screenshot when the capture includes one. Status is labeled live, recent, delayed, or sample.",
  },
] as const;

export default function ComparePanoramataRoute() {
  const structuredFaq = faqPageJsonLd(faqEntries);

  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: pageTitle,
            description: pageDescription,
            pathname: "/compare/panoramata",
            comparedProductName: "Panoramata",
          }),
        )}
      />
      <script {...jsonLdScriptProps(structuredFaq)} />
      <MarketingNav />

      <section className="ld-hero">
        <p className="ld-case">
          <span>{pageTitle}</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          Panoramata watches ads and pages from €99. Five to Nine starts from a domain paste.
        </h1>
        <p className="ld-deck-copy">
          Panoramata is the true head-to-head in this category: ads, landing pages, and a screenshot
          archive, listed from €99 to €379 a month. Five to Nine does the narrower Meta Ad Library
          plus landing-page job, with source-backed proof. Competitor prices on this page are public
          list prices as of August 2026 — check the vendor's site for current plans.
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
          <h2>What Panoramata does well.</h2>
        </div>
        <div className="ld-quiet-grid">
          {panoramataStrengths.map((item) => (
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
          {panoramataCosts.map((item) => (
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
          needed. Also see{" "}
          <Link to="/compare/foreplay-spyder">Five to Nine vs Foreplay Spyder</Link> and{" "}
          <Link to="/compare/meta-ad-library">checking the Meta Ad Library by hand</Link>. Questions?
          Email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>.
        </p>
      </section>

      <CompareCitationsFooter citations={citations} />

      <MarketingFooter />
    </main>
  );
}
