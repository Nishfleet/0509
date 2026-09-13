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
import keeptabzCitations from "~/data/compare/keeptabz-citations.json";

import "~/styles/marketing.css";
const citations = keeptabzCitations as CompareCitations;

const pageTitle = "Five to Nine vs KeepTabz";
const pageDescription =
  "KeepTabz is a 2026 launch that tracks Facebook, Instagram, and Google ad creative and spend for B2B teams. Five to Nine is scheduled, source-backed Meta Ad Library and landing-page change proof.";

export const links: LinksFunction = () => canonicalLinks("/compare/keeptabz");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: pageTitle,
    description: pageDescription,
    pathname: "/compare/keeptabz",
    ogImageUrl: compareSocialCardUrl("keeptabz"),
    ogImageAlt: "Five to Nine vs KeepTabz comparison card",
  });

const keeptabzStrengths: readonly CompareClaimCard[] = [
  {
    title: "Multi-platform creative and spend tracking",
    detail:
      "KeepTabz tracks Facebook, Instagram, and Google ad creative and spend in one place. That is a real cross-platform job, not just a Meta feed.",
    sourceId: "keeptabz-announcement",
  },
  {
    title: "A new, focused entrant",
    detail:
      "KeepTabz reached general availability in August 2026 and reports a small B2B customer base. Early-stage products are usually quick to take feature requests and feedback.",
    sourceId: "keeptabz-announcement",
  },
  {
    title: "A low entry price",
    detail:
      "KeepTabz's public entry tiers start at $49.99 and $99.99, which is below most established ad-spy incumbents. Confirm current plans on KeepTabz's site.",
    sourceId: "keeptabz-pricing",
  },
];

const keeptabzCosts: readonly CompareClaimCard[] = [
  {
    title: "A young product on a young track record",
    detail:
      "A product that reached general availability in August 2026 has a short operating history. How it holds up under sustained monitoring is not yet proven in public.",
    sourceId: "keeptabz-announcement",
  },
  {
    title: "Spend reporting, not change proof",
    detail:
      "KeepTabz's described job is tracking ad creative and spend. Five to Nine's job is the scheduled before and after: what changed on the competitor's ads and landing pages, saved with a source link.",
  },
  {
    title: "No public change-history claims",
    detail:
      "KeepTabz's public materials do not claim the diff-and-save behavior Five to Nine ships — offer, price, CTA, and hook diffs with page text, source link, and screenshot proof.",
  },
];

const fiveToNineAdds = [
  {
    theirs: "Creative and spend in one dashboard",
    ours: "You paste a competitor website. We read the public Meta Ad Library and the live landing page from that domain, then watch them on a schedule. You do not have to hunt every creative first.",
  },
  {
    theirs: "Numbers on what competitors spend",
    ours: "We look for offer, price, CTA, and hook changes, then save the page text, the original source link, and a screenshot when the capture includes one. Spend estimates inform strategy; change proof closes the loop on what actually moved.",
  },
  {
    theirs: "A fresh launch",
    ours: "Results are marked live, recent, delayed, or sample. We do not present a stale snapshot as a fresh check, whichever vendor you came from.",
  },
] as const;

export const faqEntries: ReadonlyArray<FaqJsonLdEntry> = [
  {
    question: "How much does KeepTabz cost?",
    answer:
      "The launch announcement reports entry and higher tiers, both below the established ad-spy incumbents. Confirm current plans on KeepTabz's site. The visible copy on this page cites the announcement figures.",
  },
  {
    question: "Is Five to Nine a KeepTabz alternative?",
    answer:
      "KeepTabz tracks Facebook, Instagram, and Google ad creative and spend. Five to Nine is scheduled, source-backed Meta Ad Library and landing-page change monitoring that starts from a domain paste. It is an alternative if you want the before-and-after proof rather than a spend dashboard.",
  },
  {
    question: "What does Five to Nine add?",
    answer:
      "Paid plans check watched competitors every 3–6 hours, diff offer, price, CTA, and hook fields, and save page text, the original source link, and a screenshot when the capture includes one. Status is labeled live, recent, delayed, or sample.",
  },
] as const;

export default function CompareKeeptabzRoute() {
  const structuredFaq = faqPageJsonLd(faqEntries);

  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: pageTitle,
            description: pageDescription,
            pathname: "/compare/keeptabz",
            comparedProductName: "KeepTabz",
          }),
        )}
      />
      <script {...jsonLdScriptProps(structuredFaq)} />
      <MarketingNav />
      <Breadcrumbs
        items={[
          { name: "Home", pathname: "/" },
          { name: "Competitor monitoring", pathname: "/competitor-monitoring" },
          { name: "KeepTabz", pathname: "/compare/keeptabz" },
        ]}
      />

      <section className="ld-hero">
        <p className="ld-case">
          <span>{pageTitle}</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          KeepTabz tracks creative and spend from $49.99. Five to Nine proves what changed.
        </h1>
        <p className="ld-deck-copy">
          KeepTabz reached general availability in August 2026 with a small B2B customer base,
          tracking Facebook, Instagram, and Google ad creative and spend, with entry tiers at
          $49.99 and $99.99. Five to Nine does the narrower Meta Ad Library plus landing-page job,
          with source-backed proof. Competitor prices on this page are from the launch announcement
          as of August 2026 — check the vendor's site for current plans.
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
          <h2>What KeepTabz does well.</h2>
        </div>
        <div className="ld-quiet-grid">
          {keeptabzStrengths.map((item) => (
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
          {keeptabzCosts.map((item) => (
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
          needed. Also see <Link to="/compare/panoramata">Five to Nine vs Panoramata</Link> and{" "}
          <Link to="/compare/meta-ad-library">checking the Meta Ad Library by hand</Link>. Questions?
          Email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>.
        </p>
      </section>

      <LiveBrandProof domain={LIVE_BRAND_PROOF_DOMAIN} />

      <CompareCitationsFooter citations={citations} />

      <MarketingFooter />
    </main>
  );
}
