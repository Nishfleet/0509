import { Form, Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { CompareAdsExampleLink } from "~/components/ads-internal-links";
import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import {
  Cite,
  CompareCitationsFooter,
  type CompareCitations,
  type CompareClaimCard,
} from "~/components/compare-citations";
import {
  COMPARE_CANONICAL_TARGETS,
  canonicalLinks,
  faqPageJsonLd,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
  type FaqJsonLdEntry,
} from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";
import foreplayCitations from "~/data/compare/foreplay-citations.json";

const citations = foreplayCitations as CompareCitations;

export { compareAdsExampleLoader as loader } from "~/lib/ads-internal-links.server";

const pageDescription =
  "Foreplay is an ad intelligence and creative research platform. Five to Nine is source-backed competitor change monitoring for Meta ads and landing pages.";

// Duplicate of /compare/foreplay-spyder (#1481): the generic vs-page
// canonicalizes to the narrower Spyder comparison and is absent from the
// sitemap. The page still renders HTTP 200 so existing links never 404.
export const links: LinksFunction = () =>
  canonicalLinks(COMPARE_CANONICAL_TARGETS["/compare/foreplay"]);

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Five to Nine vs Foreplay",
    description: pageDescription,
    pathname: "/compare/foreplay",
  });

const foreplayStrengths: readonly CompareClaimCard[] = [
  {
    title: "Massive ad creative library",
    detail:
      "Foreplay's Discovery index and community Swipe File cover millions of saved ads across Meta, TikTok, LinkedIn, Google, and other platforms.",
    sourceId: "foreplay-discovery",
  },
  {
    title: "Creative-first research",
    detail:
      "It is built for creative strategists: save ads, tag them, build swipe files, and share inspiration with a team.",
    sourceId: "foreplay-home",
  },
  {
    title: "Spyder competitor tracking",
    detail:
      "Foreplay's Spyder product tracks a competitor's Meta ads, landing page screenshots, creative timeline, and top hooks.",
    sourceId: "foreplay-spyder",
  },
  {
    title: "Briefs and analytics",
    detail:
      "You can turn saved ads into creative briefs, run creative scoring, and see competitor creative tests and media mix.",
    sourceId: "foreplay-home",
  },
];

const foreplayCosts: readonly CompareClaimCard[] = [
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
    sourceId: "foreplay-home",
  },
];

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

export const faqEntries: ReadonlyArray<FaqJsonLdEntry> = [
  {
    question: "How is Five to Nine different from Foreplay?",
    answer:
      "Foreplay is an ad intelligence and creative research platform — a large multi-platform ad index, swipe files, creative briefs, and the Spyder competitor tracker. Five to Nine is source-backed competitor change monitoring: it reads the public Meta Ad Library and the live landing page from a domain paste, diffs the commercial fields, and saves each change with the source link and a timestamp.",
  },
  {
    question: "Does Foreplay track competitor landing-page changes?",
    answer:
      "Foreplay's Spyder product archives competitor Meta ads and landing-page screenshots, but public Foreplay writing describes that archive without a before/after diff on an existing ad or page. Monitoring specific landing-page copy or price changes on a schedule is not Foreplay's primary job. See the Five to Nine vs Foreplay Spyder page for that tracking case.",
  },
  {
    question: "Which tool is better for ad change alerts?",
    answer:
      "Use Foreplay if you need a creative swipe file and a large multi-platform ad index for inspiration. Use Five to Nine if you need scheduled, source-backed proof of Meta ad and landing-page changes. Many teams could use both for different jobs — Foreplay for creative research, Five to Nine for change monitoring with proof.",
  },
  {
    question: "Does Foreplay cover the Meta Ad Library?",
    answer:
      "Yes. Foreplay's Discovery index and Spyder competitor tracking read the public Meta Ad Library among other platforms (TikTok, LinkedIn, Google). Five to Nine reads the same public Meta Ad Library but is narrower in ad-library breadth — it focuses on proof-backed Meta Ad Library plus landing-page changes rather than multi-platform creative aggregation.",
  },
] as const;

export default function CompareForeplayRoute() {
  const structuredFaq = faqPageJsonLd(faqEntries);

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
      <script {...jsonLdScriptProps(structuredFaq)} />
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
          <h2>Where ad intelligence differs from change monitoring.</h2>
        </div>
        <div className="ld-quiet-grid">
          {foreplayCosts.map((item) => (
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

      <CompareCitationsFooter citations={citations} />

      <MarketingFooter />
    </main>
  );
}
