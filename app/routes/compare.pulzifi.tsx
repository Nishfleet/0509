import { Form, Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { CompareAdsExampleLink } from "~/components/ads-internal-links";
import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import { canonicalLinks, jsonLdScriptProps, publicSeoMeta, socialCardImage, webPageJsonLd } from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

export { compareAdsExampleLoader as loader } from "~/lib/ads-internal-links.server";

const pageDescription =
  "Pulzifi monitors public URLs and delivers AI strategy briefs on every change. Five to Nine keeps the proof source-first and ties it to Meta Ad Library checks.";

export const links: LinksFunction = () => canonicalLinks("/compare/pulzifi");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Five to Nine vs Pulzifi",
    description: pageDescription,
    pathname: "/compare/pulzifi",
    image: socialCardImage("compare", "pulzifi", "Five to Nine vs Pulzifi"),
  });

const pulzifiStrengths = [
  {
    title: "AI strategy briefs",
    detail:
      "Pulzifi turns each detected change into a brief with an overview, market analysis, and marketing lens. Copy it, share it, or act on it.",
  },
  {
    title: "Any public URL",
    detail:
      "You can monitor competitor pages, client pages, news sources, government portals, real estate listings, and more. Choose a frequency from 5 minutes to 48 hours.",
  },
  {
    title: "Visual and text diffs",
    detail:
      "Visual Pulse and Text Changes show before/after by section and word, so you can see exactly what moved.",
  },
  {
    title: "Opportunity scoring",
    detail:
      "Each change gets an opportunity score and recommended next actions, not just a timestamp.",
  },
] as const;

const pulzifiCosts = [
  {
    title: "Brief is AI-synthesized",
    detail:
      "The strategic interpretation is generated; it is not a direct quote of the competitor's source. Treat it as a starting point, not a citation.",
  },
  {
    title: "Not ad-library specific",
    detail:
      "Pulzifi is URL-first. It does not pull from the Meta Ad Library or tie ad creative to landing-page changes.",
  },
  {
    title: "Plans and limits vary",
    detail:
      "Pricing is published in tiers; check the live source at https://pulzifi.com/ for current limits and frequency options.",
  },
] as const;

const fiveToNineAdds = [
  {
    theirs: "Source-first competitor evidence",
    ours: "We save the page text, the source link, and a screenshot when the capture includes one, so every claim is traceable.",
  },
  {
    theirs: "Ad-to-landing-page continuity",
    ours: "Meta Ad Library checks and landing-page scans are linked in the same watchlist event.",
  },
  {
    theirs: "Honest status labels",
    ours: "Results are marked live, recent, delayed, or sample. We do not present a generated brief as live source proof.",
  },
  {
    theirs: "Digest delivery by email",
    ours: "Daily or weekly email briefs with instant alerts on Starter and Agency.",
  },
] as const;

export default function ComparePulzifiRoute() {
  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "Five to Nine vs Pulzifi",
            description: pageDescription,
            pathname: "/compare/pulzifi",
            comparedProductName: "Pulzifi",
          }),
        )}
      />
      <MarketingNav />

      <section className="ld-hero">
        <p className="ld-case">
          <span>Five to Nine vs Pulzifi</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          Pulzifi turns changes into strategy briefs. Five to Nine keeps the proof source-first.
        </h1>
        <p className="ld-deck-copy">
          Pulzifi gives AI-generated strategic reads on web changes. Five to Nine is narrower: Meta
          Ad Library + landing-page changes, saved with source proof.
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
          <h2>What Pulzifi does well.</h2>
        </div>
        <div className="ld-quiet-grid">
          {pulzifiStrengths.map((item) => (
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
          <h2>Where the brief becomes interpretation.</h2>
        </div>
        <div className="ld-quiet-grid">
          {pulzifiCosts.map((item) => (
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
