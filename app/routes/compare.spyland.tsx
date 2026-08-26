import { Form, Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import { canonicalLinks, jsonLdScriptProps, publicSeoMeta, webPageJsonLd } from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

const pageDescription =
  "Spyland watches competitor landing pages daily and flags copy, pricing, and CTA changes. Five to Nine adds the ad source and more frequent source-backed checks.";

export const links: LinksFunction = () => canonicalLinks("/compare/spyland");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Five to Nine vs Spyland",
    description: pageDescription,
    pathname: "/compare/spyland",
  });

const spylandStrengths = [
  {
    title: "Daily competitor page checks",
    detail:
      "Add competitor landing, pricing, or feature pages and Spyland checks them once a day, flagging copy, pricing, and CTA changes.",
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
  },
  {
    title: "AI change analysis",
    detail:
      "Each change comes with a short AI read of what changed and what to test on your own page. Treat it as a starting point, not a source citation.",
  },
] as const;

const spylandCosts = [
  {
    title: "Landing pages only",
    detail:
      "Spyland focuses on the pages you add. It does not pull from public ad libraries or save ad-creative evidence alongside the page.",
  },
  {
    title: "Daily is the default cadence",
    detail:
      "Faster or slower check frequencies may be available, but daily is the standard pitch. Confirm current plans on the live source at https://spyland.ing/.",
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

      <section className="ld-hero">
        <p className="ld-case">
          <span>Five to Nine vs Spyland</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          Spyland tracks landing-page changes daily. Five to Nine adds the ad source and faster
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

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">Credit where due</span>
          <h2>What Spyland does well.</h2>
        </div>
        <div className="ld-quiet-grid">
          {spylandStrengths.map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
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
              <p>{item.detail}</p>
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
          needed — and see what is publicly available before deciding anything. Questions about
          coverage? Email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we&rsquo;ll answer
          honestly.
        </p>
      </section>

      <MarketingFooter />
    </main>
  );
}
