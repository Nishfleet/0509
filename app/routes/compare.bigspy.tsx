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
import bigspyCitations from "~/data/compare/bigspy-citations.json";

// Source verification (issue #3092): primary-source-verified —
// https://bigspy.com/ and https://bigspy.com/pricing return HTTP 200 and name
// real tiers (Free / Starter $69 / Growth $159 / Ultimate $499) — verified
// live 2026-09-12.
const citations = bigspyCitations as CompareCitations;

const pageTitle = "Five to Nine vs BigSpy";
const pageDescription =
  "BigSpy is a free-entry ad spy database covering 10 major ad platforms. Five to Nine is scheduled, source-backed Meta Ad Library and landing-page change proof.";

export const links: LinksFunction = () => canonicalLinks("/compare/bigspy");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: pageTitle,
    description: pageDescription,
    pathname: "/compare/bigspy",
    ogImageUrl: compareSocialCardUrl("bigspy"),
    ogImageAlt: "Five to Nine vs BigSpy comparison card",
  });

const bigspyStrengths: readonly CompareClaimCard[] = [
  {
    title: "Ten platforms in one library",
    detail:
      "BigSpy covers 10 major ad platforms — Facebook, Instagram, TikTok, YouTube, Twitter, Pinterest and more — so one search spans most of where competitor ads run.",
    sourceId: "bigspy-home",
  },
  {
    title: "A genuinely free entry",
    detail:
      "BigSpy publishes a Free plan alongside its paid tiers, so you can test the library before paying anything.",
    sourceId: "bigspy-pricing",
  },
  {
    title: "Creative inspiration at scale",
    detail:
      "BigSpy describes a creative library of over 1 billion ads with daily selections of top-performing and trending creative.",
    sourceId: "bigspy-home",
  },
  {
    title: "Niche and trend research",
    detail:
      "Beyond ad lookup, BigSpy ships niche-market research, domain analysis, and trend research tools for finding new angles.",
    sourceId: "bigspy-home",
  },
] as const;

const bigspyCosts: readonly CompareClaimCard[] = [
  {
    title: "A library to search, not a change feed",
    detail:
      "BigSpy's published scope is ad discovery and tracking. It does not advertise the scheduled before-and-after diff — what changed on a competitor's ads and landing pages, saved as proof — that Five to Nine is built around.",
    sourceId: "bigspy-home",
  },
  {
    title: "Breadth over depth on one library",
    detail:
      "Ten-platform coverage trades depth for spread. If the job is watching the Meta Ad Library and a competitor's own pages on a schedule, a focused tool reads closer to the source.",
  },
  {
    title: "Deeper access sits behind tiers",
    detail:
      "BigSpy's paid plans run Starter at $69/month, Growth at $159/month, and Ultimate at $499/month — check BigSpy's pricing page for current limits before you commit.",
    sourceId: "bigspy-pricing",
  },
] as const;

const fiveToNineAdds = [
  {
    theirs: "A ten-platform ad library",
    ours: "You paste a competitor website. We read the public Meta Ad Library and the live landing page from that domain, then watch them on a schedule — no hunting every creative first.",
  },
  {
    theirs: "Creative inspiration at scale",
    ours: "We look for offer, price, CTA, and hook changes, then save the page text, the original source link, and a screenshot when the capture includes one — proof, not just ideas.",
  },
  {
    theirs: "A free entry plan",
    ours: "Results are marked live, recent, delayed, or sample. We do not present a stale snapshot as a fresh check, whichever vendor you came from.",
  },
] as const;

export const faqEntries: ReadonlyArray<FaqJsonLdEntry> = [
  {
    question: "How much does BigSpy cost?",
    answer:
      "BigSpy publishes a Free plan plus Starter at $69/month, Growth at $159/month, and Ultimate at $499/month on its site, with annual and group-buy offers. Confirm current plans on BigSpy's pricing page.",
  },
  {
    question: "Is Five to Nine a BigSpy alternative?",
    answer:
      "BigSpy is a multi-platform ad-spy database for finding and analyzing ads. Five to Nine is scheduled, source-backed Meta Ad Library and landing-page change monitoring that starts from a domain paste — an alternative when the job is the before-and-after record rather than library search.",
  },
  {
    question: "What does Five to Nine add?",
    answer:
      "Paid plans check watched competitors every 3–6 hours, diff offer, price, CTA, and hook fields, and save page text, the original source link, and a screenshot when the capture includes one. Status is labeled live, recent, delayed, or sample.",
  },
] as const;

export default function CompareBigspyRoute() {
  const structuredFaq = faqPageJsonLd(faqEntries);

  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: pageTitle,
            description: pageDescription,
            pathname: "/compare/bigspy",
            comparedProductName: "BigSpy",
          }),
        )}
      />
      <script {...jsonLdScriptProps(structuredFaq)} />
      <MarketingNav />
      <Breadcrumbs
        items={[
          { name: "Home", pathname: "/" },
          { name: "Competitor monitoring", pathname: "/competitor-monitoring" },
          { name: "BigSpy", pathname: "/compare/bigspy" },
        ]}
      />

      <section className="ld-hero">
        <p className="ld-case">
          <span>{pageTitle}</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          BigSpy searches ten ad platforms. Five to Nine proves what changed.
        </h1>
        <p className="ld-deck-copy">
          BigSpy is a free-entry ad spy database covering 10 major platforms, with plans from
          Starter at $69/month up to Ultimate at $499/month. Five to Nine does the narrower Meta
          Ad Library plus landing-page job, with source-backed proof. Competitor prices on this
          page are from BigSpy's own site as of September 2026 — check the vendor's site for
          current plans.
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
          <h2>What BigSpy does well.</h2>
        </div>
        <div className="ld-quiet-grid">
          {bigspyStrengths.map((item) => (
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
          {bigspyCosts.map((item) => (
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
          needed. Also see <Link to="/compare/adspy">Five to Nine vs AdSpy</Link> and{" "}
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
