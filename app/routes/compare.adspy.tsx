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
  compareSocialCardUrl,
  faqPageJsonLd,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
  type FaqJsonLdEntry,
} from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";
import adspyCitations from "~/data/compare/adspy-citations.json";
import "../marketing.css";

const citations = adspyCitations as CompareCitations;

const pageTitle = "Five to Nine vs AdSpy";
const pageDescription =
  "AdSpy is a single-plan ad-spy database with a 2.4/5 Trustpilot rating and no self-service cancel. Five to Nine is scheduled, source-backed Meta Ad Library and landing-page change proof.";

export const links: LinksFunction = () => canonicalLinks("/compare/adspy");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: pageTitle,
    description: pageDescription,
    pathname: "/compare/adspy",
    ogImageUrl: compareSocialCardUrl("adspy"),
    ogImageAlt: "Five to Nine vs AdSpy comparison card",
  });

const adspyStrengths: readonly CompareClaimCard[] = [
  {
    title: "A huge ad database",
    detail:
      "AdSpy is a long-running ad-spy database that indexes a very large volume of Meta ads. If you want to browse a raw feed of what competitors are running, that is its core job.",
    sourceId: "adspy-pricing",
  },
  {
    title: "A single, simple plan",
    detail:
      "AdSpy lists one $149/month plan on its home page. There is no tier ladder to compare, which keeps the buying decision simple.",
    sourceId: "adspy-pricing",
  },
  {
    title: "Established incumbent",
    detail:
      "AdSpy has been around for years and is a named incumbent in the ad-spy category. It is the kind of tool buyers already know by name when they search for an alternative.",
    sourceId: "adspy-pricing",
  },
];

const adspyCosts: readonly CompareClaimCard[] = [
  {
    title: "A 2.4/5 Trustpilot rating",
    detail:
      "AdSpy's Trustpilot rating is 2.4 out of 5, with a large share of one-star reviews. That is a weak satisfaction signal for a tool you would pay $149 a month to keep.",
    sourceId: "adspy-trustpilot",
  },
  {
    title: "No self-service cancel",
    detail:
      "AdSpy does not offer a self-service cancel path, and reviewers report being charged after they tried to cancel. That is a real lock-in cost on top of the $149/month price.",
    sourceId: "adspy-trustpilot",
  },
  {
    title: "No public API",
    detail:
      "AdSpy has no public API, which is the largest structural limitation in 2026. You cannot pull its data into your own workflow or automation, so the database is a walled garden.",
  },
];

const fiveToNineAdds = [
  {
    theirs: "A raw ad feed",
    ours: "Paid plans check every 3–6 hours and compare each scan to the last one, so you hear when an offer, price, or CTA actually moved — not a re-listing of everything running.",
  },
  {
    theirs: "A database you browse",
    ours: "Confirmed changes are saved with the page text, the original source link, and a screenshot when the capture includes one, so the claim survives a closed tab.",
  },
  {
    theirs: "A walled garden",
    ours: "Results are marked live, recent, delayed, or sample. We do not present a stale snapshot as a fresh check, and you are never locked into a plan you cannot cancel.",
  },
] as const;

export const faqEntries: ReadonlyArray<FaqJsonLdEntry> = [
  {
    question: "How much does AdSpy cost?",
    answer:
      "AdSpy lists a single monthly plan on its home page. Confirm current pricing on AdSpy's site. The visible copy on this page cites that figure.",
  },
  {
    question: "Is Five to Nine an AdSpy alternative?",
    answer:
      "AdSpy is a single-plan ad-spy database with a 2.4/5 Trustpilot rating and no self-service cancel. Five to Nine is scheduled, source-backed proof of Meta Ad Library and landing-page changes. It is an alternative if you need the change proof and a plan you can cancel, not if you want a raw feed of millions of ads.",
  },
  {
    question: "Does AdSpy have an API?",
    answer:
      "AdSpy has no public API, which is the largest structural limitation in 2026. Five to Nine's pages state only the capture and proof behavior we actually ship.",
  },
] as const;

export default function CompareAdspyRoute() {
  const structuredFaq = faqPageJsonLd(faqEntries);

  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: pageTitle,
            description: pageDescription,
            pathname: "/compare/adspy",
            comparedProductName: "AdSpy",
          }),
        )}
      />
      <script {...jsonLdScriptProps(structuredFaq)} />
      <MarketingNav />
      <Breadcrumbs
        items={[
          { name: "Home", pathname: "/" },
          { name: "Competitor monitoring", pathname: "/competitor-monitoring" },
          { name: "AdSpy", pathname: "/compare/adspy" },
        ]}
      />

      <section className="ld-hero">
        <p className="ld-case">
          <span>{pageTitle}</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          AdSpy is a $149/mo ad-spy database. Five to Nine is change proof with a source link.
        </h1>
        <p className="ld-deck-copy">
          AdSpy lists a single $149/month plan and carries a 2.4/5 Trustpilot rating with no
          self-service cancel. It is a big ad database, but it is a walled garden. Five to Nine is
          for the scheduled before and after, with a source link and a screenshot when the capture
          includes one. Competitor prices on this page are public list prices as of September 2026 —
          check the vendor's site for current plans.
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

      <section className="ld-quiet" data-source-url={citations.sources[0].href}>
        <div className="ld-section-head">
          <span className="ld-kicker">Credit where due</span>
          <h2>What AdSpy does well.</h2>
        </div>
        <div className="ld-quiet-grid">
          {adspyStrengths.map((item) => (
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
          <h2>Where a big database differs from proof.</h2>
        </div>
        <div className="ld-quiet-grid">
          {adspyCosts.map((item) => (
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
          needed. Also see <Link to="/compare/adspyder">Five to Nine vs AdSpyder</Link> and{" "}
          <Link to="/compare/foreplay-spyder">Five to Nine vs Foreplay Spyder</Link>. Questions?
          Email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>.
        </p>
      </section>

      <CompareCitationsFooter citations={citations} />

      <MarketingFooter />
    </main>
  );
}
