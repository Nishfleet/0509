import { Form, Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { CompareAdsExampleLink } from "~/components/ads-internal-links";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import { LiveBrandProof } from "~/components/live-brand-proof";
import {
  Cite,
  CompareCitationsFooter,
  type CompareCitations,
  type CompareClaimCard,
} from "~/components/compare-citations";
import { canonicalLinks, compareSocialCardUrl, jsonLdScriptProps, publicSeoMeta, webPageJsonLd } from "~/lib/seo";
import { LIVE_BRAND_PROOF_DOMAIN } from "~/lib/demo-brand-pages";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";
import spylandCitations from "~/data/compare/spyland-citations.json";

// Source verification (issue #1288, #2069, #2835, #3019): primary-source-verified —
// https://spyland.ing/ returns HTTP 200 and names the product with a Free plan
// ($0, weekly checks) and paid Solo / Business tiers with daily checks; dollar
// prices are not published on the page — verified live 2026-09-11.
const citations = spylandCitations as CompareCitations;

export { compareAdsExampleLoader as loader } from "~/lib/ads-internal-links.server";

import "~/styles/marketing.css";
const pageDescription =
  "Spyland watches competitor landing pages on a schedule and flags copy, pricing, and CTA changes. Five to Nine adds the ad source and more frequent source-backed checks.";

export const links: LinksFunction = () => canonicalLinks("/compare/spyland");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Five to Nine vs Spyland",
    description: pageDescription,
    pathname: "/compare/spyland",
    ogImageUrl: compareSocialCardUrl("spyland"),
    ogImageAlt: "Five to Nine vs Spyland comparison card",
  });

const spylandStrengths: readonly CompareClaimCard[] = [
  {
    title: "Scheduled competitor page checks",
    detail:
      "Add competitor landing, pricing, or feature pages and Spyland checks them on a schedule — weekly on the Free plan, daily on paid plans — flagging copy, pricing, and CTA changes.",
    sourceId: "spyland-home",
  },
  {
    title: "Noise filtering",
    detail:
      "It is designed to ignore CSS, ad, and script noise and surface real copy and structure changes.",
  },
  {
    title: "Before/after screenshots",
    detail:
      "Side-by-side screenshots show how the page looked before and after each detected change.",
    sourceId: "spyland-home",
  },
  {
    title: "AI change analysis",
    detail:
      "Each change comes with a short AI read of what changed and what to test on your own page. Treat it as a starting point, not a source citation.",
    sourceId: "spyland-home",
  },
] as const;

const spylandCosts: readonly CompareClaimCard[] = [
  {
    title: "Landing pages only",
    detail:
      "Spyland focuses on the pages you add. It does not pull from public ad libraries or save ad-creative evidence alongside the page.",
  },
  {
    title: "Free checks weekly, paid plans daily",
    detail:
      "The Free plan checks weekly; Solo and Business check daily. Confirm current plans on the live source at SpyLand.ing.",
    sourceId: "spyland-pricing",
  },
  {
    title: "Page insight, not ad source",
    detail:
      "The brief is about the competitor page, not the ad that sent traffic there. You still connect the ad to the landing page yourself.",
  },
] as const;

const fiveToNineAdds = [
  {
    theirs: "Ad library + landing page in one loop",
    ours: "We read the public Meta Ad Library for the ad, then check the landing page it leads to, so the offer and the destination move together.",
  },
  {
    theirs: "More frequent checks",
    ours: "Paid plans check every 3–6 hours on Starter and Agency, with instant alerts available on those plans.",
  },
  {
    theirs: "Source-linked evidence",
    ours: "Every saved change carries the page text, the original URL, and a screenshot when the capture includes one, so you can cite it in a report.",
  },
  {
    theirs: "Email digests and alerts",
    ours: "Daily or weekly email briefs, with instant alerts on Starter and Agency.",
  },
] as const;

export default function CompareSpylandRoute() {
  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "Five to Nine vs Spyland",
            description: pageDescription,
            pathname: "/compare/spyland",
            comparedProductName: "Spyland",
          }),
        )}
      />
      <MarketingNav />
      <Breadcrumbs
        items={[
          { name: "Home", pathname: "/" },
          { name: "Competitor monitoring", pathname: "/competitor-monitoring" },
          { name: "Spyland", pathname: "/compare/spyland" },
        ]}
      />

      <section className="ld-hero">
        <p className="ld-case">
          <span>Five to Nine vs Spyland</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          Spyland tracks landing-page changes on a schedule. Five to Nine adds the ad source and faster
          checks.
        </h1>
        <p className="ld-deck-copy">
          Spyland is a focused landing-page monitor. If you also need the ad that drove the change
          and source-linked proof, Five to Nine closes the loop.
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
          <h2>What Spyland does well.</h2>
        </div>
        <div className="ld-quiet-grid">
          {spylandStrengths.map((item) => (
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
          <h2>Where it stops.</h2>
        </div>
        <div className="ld-quiet-grid">
          {spylandCosts.map((item) => (
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
        <CompareAdsExampleLink />
        <p className="ld-pricing-note">
          Paste a competitor website into the <Link to="/search">search preview</Link> — no account
          needed — and see what is publicly available before deciding anything. Questions about
          coverage? Email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we&rsquo;ll answer
          honestly.
        </p>
      </section>

      <LiveBrandProof domain={LIVE_BRAND_PROOF_DOMAIN} />

      <CompareCitationsFooter citations={citations} />

      <MarketingFooter />
    </main>
  );
}
