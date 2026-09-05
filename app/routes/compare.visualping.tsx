import { Form, Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { CompareAdsExampleLink } from "~/components/ads-internal-links";
import { Breadcrumbs } from "~/components/breadcrumbs";
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
import visualpingCitations from "~/data/compare/visualping-citations.json";

const citations = visualpingCitations as CompareCitations;

export { compareAdsExampleLoader as loader } from "~/lib/ads-internal-links.server";

const pageDescription =
  "Visualping monitors public pages for visual, text, and element changes. Five to Nine is built around competitor ad and landing-page moves with source-backed proof.";

// Duplicate of /compare/visualping-ad-libraries (#1481, #1548): the generic vs-page
// canonicalizes to the narrower ad-library comparison and is absent from the
// sitemap. The page still renders HTTP 200 so existing links never 404.
export const links: LinksFunction = () =>
  canonicalLinks(COMPARE_CANONICAL_TARGETS["/compare/visualping"]);

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Five to Nine vs Visualping",
    description: pageDescription,
    pathname: "/compare/visualping",
  });

const visualpingStrengths: readonly CompareClaimCard[] = [
  {
    title: "Works on any public URL",
    detail:
      "Paste a page and monitor the whole thing or a selected area. Visualping is not tied to any ad library, so any public page is a valid target.",
    sourceId: "visualping-home",
  },
  {
    title: "Free tier and flexible paid plans",
    detail:
      "Visualping publishes a free plan with limited checks and pages, plus paid plans that add frequency, volume, and team features. Check its pricing page for current limits.",
    sourceId: "visualping-pricing",
  },
  {
    title: "Multiple change modes",
    detail:
      "Visual, text, element, and all-in modes let you decide whether to watch pixels, copy, or a specific box on the page.",
    sourceId: "visualping-home",
  },
  {
    title: "Broad alert stack",
    detail:
      "Email, Slack, Microsoft Teams, webhooks, SMS, and API alerts are available on paid plans; the free plan still gets core notifications.",
    sourceId: "visualping-integrations",
  },
];

const visualpingCosts: readonly CompareClaimCard[] = [
  {
    title: "You configure every page and frequency",
    detail:
      "Monitoring cadence and page volume are priced by checks and pages. Watching many competitor pages at high frequency moves you up the plans.",
    sourceId: "visualping-pricing",
  },
  {
    title: "General-purpose, not competitor-specific",
    detail:
      "Visualping tells you that something changed; it does not tie the change to an ad library, a campaign, or a source link. The interpretation is on you.",
  },
  {
    title: "Evidence is fragmented",
    detail:
      "Screenshots and diffs are available, but building a shared, timestamped, source-linked trail for a team takes manual work outside the tool.",
  },
];

const fiveToNineAdds = [
  {
    theirs: "Built for competitor ad and landing-page changes",
    ours: "We read the public Meta Ad Library and the live landing page, then diff the parts that matter for growth: offers, prices, CTAs, and hooks.",
  },
  {
    theirs: "Proof, not just alerts",
    ours: "Every change is saved with the page text, the original source link, and a screenshot when the capture includes one, so the claim does not depend on a dashboard.",
  },
  {
    theirs: "Scheduled, source-backed briefs",
    ours: "Paid plans check every 3–6 hours and send a daily or weekly email digest. You do not have to configure each URL's check interval.",
  },
  {
    theirs: "Honest status labels",
    ours: "Results are marked live, recent, delayed, or sample. We do not present a stale snapshot as a fresh check.",
  },
] as const;

export const faqEntries: ReadonlyArray<FaqJsonLdEntry> = [
  {
    question: "How is Five to Nine different from Visualping?",
    answer:
      "Visualping is a general-purpose page-change monitor: you paste a URL and it flags visual, text, or element diffs. Five to Nine is built for competitor ad and landing-page moves — it reads the public Meta Ad Library and the live landing page from a domain paste, then diffs the commercial fields (offer, price, CTA, hook) and saves each change with the source link.",
  },
  {
    question: "Does Visualping monitor the Meta Ad Library?",
    answer:
      "Visualping can watch a Meta Ad Library URL if you find and paste that URL yourself, with visual diffs on a free or paid plan. It does not start from a competitor domain or name the offer, price, or CTA behind a new ad. For that ad-library case specifically, see the Five to Nine vs Visualping for ad libraries page.",
  },
  {
    question: "Which tool is better for ad change alerts?",
    answer:
      "Use Visualping if you already have a specific page URL and want a generic pixel or text diff. Use Five to Nine if you want scheduled, source-backed proof of competitor offer and landing-page changes without hunting each URL. Visualping flags that something changed; Five to Nine captures the commercial move with proof.",
  },
  {
    question: "Does Visualping have false positives?",
    answer:
      "Yes. Visualping's own writing says most detected changes are not important and that false positives will never reach zero — banner rotation, cookie popups, timestamps, and layout shift all look like changes. Five to Nine diffs the commercial fields instead of pixels, so a layout shift is not sold as a competitor move.",
  },
] as const;

export default function CompareVisualpingRoute() {
  const structuredFaq = faqPageJsonLd(faqEntries);

  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "Five to Nine vs Visualping",
            description: pageDescription,
            pathname: "/compare/visualping",
            comparedProductName: "Visualping",
          }),
        )}
      />
      <script {...jsonLdScriptProps(structuredFaq)} />
      <MarketingNav />
      <Breadcrumbs
        items={[
          { name: "Home", pathname: "/" },
          { name: "Competitor monitoring", pathname: "/competitor-monitoring" },
          { name: "Visualping", pathname: "/compare/visualping" },
        ]}
      />

      <section className="ld-hero">
        <p className="ld-case">
          <span>Five to Nine vs Visualping</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          Visualping catches page changes. Five to Nine captures the competitor move with proof.
        </h1>
        <p className="ld-deck-copy">
          Visualping is a solid website-change monitor. For tracking competitor offers, prices, and
          landing-page moves, the job is slightly different — and we built Five to Nine for that.
          For the Meta Ad Library case specifically, see{" "}
          <Link to="/compare/visualping-ad-libraries">
            Five to Nine vs Visualping for ad libraries
          </Link>
          .
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
          <h2>What Visualping does well.</h2>
        </div>
        <div className="ld-quiet-grid">
          {visualpingStrengths.map((item) => (
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
          {visualpingCosts.map((item) => (
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
          honestly, including &ldquo;Visualping alone is enough for you.&rdquo;
        </p>
      </section>

      <section className="ld-quiet">
        <div className="ld-section-head">
          <span className="ld-kicker">Our noise floor</span>
          <h2>Phantom changes we refuse to alert on.</h2>
        </div>
        <p>
          Visualping's own published complaint is phantom changes and alert noise. Five to Nine diffs the
          commercial fields instead of pixels, and a capture that fails the validity gate — error pages,
          bot walls, cookie walls, partial loads, and churn-only edits — is recorded as failed or
          suppressed and never becomes an alert. See{" "}
          <Link to="/capture-rules">the capture rules</Link> for the full checkable list.
        </p>
      </section>

      <CompareCitationsFooter citations={citations} />

      <MarketingFooter />
    </main>
  );
}
