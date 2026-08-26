import { Form, Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { CompareAdsExampleLink } from "~/components/ads-internal-links";
import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import { canonicalLinks, jsonLdScriptProps, publicSeoMeta, webPageJsonLd } from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

export { compareAdsExampleLoader as loader } from "~/lib/ads-internal-links.server";

const pageDescription =
  "Foreplay is an ad intelligence and creative research platform. Five to Nine is source-backed competitor change monitoring for Meta ads and landing pages.";

export const links: LinksFunction = () => canonicalLinks("/compare/foreplay");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Five to Nine vs Foreplay",
    description: pageDescription,
    pathname: "/compare/foreplay",
  });

const foreplayStrengths = [
  {
    title: "Massive ad creative library",
    detail:
      "Foreplay's Discovery index and community Swipe File cover millions of saved ads across Meta, TikTok, LinkedIn, Google, and other platforms.",
  },
  {
    title: "Creative-first research",
    detail:
      "It is built for creative strategists: save ads, tag them, build swipe files, and share inspiration with a team.",
  },
  {
    title: "Spyder competitor tracking",
    detail:
      "Foreplay's Spyder product tracks a competitor's Meta ads, landing page screenshots, creative timeline, and top hooks.",
  },
  {
    title: "Briefs and analytics",
    detail:
      "You can turn saved ads into creative briefs, run creative scoring, and see competitor creative tests and media mix.",
  },
] as const;

const foreplayCosts = [
  {
    title: "Ad intelligence, not page monitoring",
    detail:
      "Foreplay is best for ad creative research and inspiration. Monitoring specific landing-page copy or price changes on a schedule is not its primary job.",
  },
  {
    title: "Depth in creative, not source proof",
    detail:
      "You see what ran, but building a source-linked, timestamped evidence trail of a specific change takes manual work.",
  },
  {
    title: "Multi-platform breadth",
    detail:
      "Foreplay covers many platforms. Five to Nine currently reads the Meta Ad Library only, so it is narrower in ad-library breadth.",
  },
] as const;

const fiveToNineAdds = [
  {
    theirs: "Meta Ad Library + change proof",
    ours: "We read the same public Meta Ad Library Foreplay uses, then diff the landing page for offer, price, and CTA changes and save evidence.",
  },
  {
    theirs: "Scheduled checks with timestamps",
    ours: "Paid plans check every 3–6 hours and store before/after page text, plus a screenshot when the capture includes one.",
  },
  {
    theirs: "Email briefs, not dashboards",
    ours: "Changes arrive as a daily or weekly email digest with instant alerts on Starter and Agency.",
  },
  {
    theirs: "Honest scope",
    ours: "We do not aggregate TikTok, Google, or LinkedIn ad libraries. We focus on proof-backed Meta Ad Library + landing-page changes.",
  },
] as const;

export default function CompareForeplayRoute() {
  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "Five to Nine vs Foreplay",
            description: pageDescription,
            pathname: "/compare/foreplay",
            comparedProductName: "Foreplay",
          }),
        )}
      />
      <MarketingNav />

      <section className="ld-hero">
        <p className="ld-case">
          <span>Five to Nine vs Foreplay</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          Foreplay is creative research. Five to Nine is change monitoring with proof.
        </h1>
        <p className="ld-deck-copy">
          Foreplay is strong for ad inspiration and creative research. Five to Nine is for scheduled,
          source-backed proof of competitor offer and landing-page changes. Spyder is Foreplay's
          competitor-tracking product — see{" "}
          <Link to="/compare/foreplay-spyder">Five to Nine vs Foreplay Spyder</Link>.
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
          <h2>What Foreplay does well.</h2>
        </div>
        <div className="ld-quiet-grid">
          {foreplayStrengths.map((item) => (
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
          <h2>Where ad intelligence differs from change monitoring.</h2>
        </div>
        <div className="ld-quiet-grid">
          {foreplayCosts.map((item) => (
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
        <CompareAdsExampleLink />
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
