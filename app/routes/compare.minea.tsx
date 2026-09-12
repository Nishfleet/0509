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
import mineaCitations from "~/data/compare/minea-citations.json";

import "~/styles/marketing.css";

// Source verification (issue #3092): primary-source-verified —
// https://minea.com/ and https://minea.com/pricing return HTTP 200 and name
// real tiers (Starter $49 / Premium $99 / Business $199 monthly) — verified
// live 2026-09-12.
const citations = mineaCitations as CompareCitations;

const pageTitle = "Five to Nine vs Minea";
const pageDescription =
  "Minea is an ad-spy tool for e-commerce and dropshipping product research. Five to Nine is scheduled, source-backed Meta Ad Library and landing-page change proof.";

export const links: LinksFunction = () => canonicalLinks("/compare/minea");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: pageTitle,
    description: pageDescription,
    pathname: "/compare/minea",
    ogImageUrl: compareSocialCardUrl("minea"),
    ogImageAlt: "Five to Nine vs Minea comparison card",
  });

const mineaStrengths: readonly CompareClaimCard[] = [
  {
    title: "Product research first",
    detail:
      "Minea is built for e-commerce and dropshipping: a database of top-performing ads and shops aimed at finding a winning product fast.",
    sourceId: "minea-home",
  },
  {
    title: "Ads and shops together",
    detail:
      "Minea tracks trending shops alongside ads — traffic, revenue, and the apps behind them — so you see the store strategy, not just the creative.",
    sourceId: "minea-home",
  },
  {
    title: "Published three-tier pricing",
    detail:
      "Minea lists Starter at $49/month, Premium at $99/month, and Business at $199/month on monthly billing, with lower per-month rates when paid quarterly.",
    sourceId: "minea-pricing",
  },
] as const;

const mineaCosts: readonly CompareClaimCard[] = [
  {
    title: "Discovery, not the diff",
    detail:
      "Minea's published scope is finding products and ads worth copying. It does not advertise a scheduled before-and-after record of what changed on a named competitor's ads and landing pages.",
    sourceId: "minea-home",
  },
  {
    title: "An e-commerce lens",
    detail:
      "Minea is aimed at dropshippers picking products. If the job is watching a named competitor's commercial moves over time — offer, price, CTA, hook — that is a different tool.",
  },
  {
    title: "Per-month rates shift with billing",
    detail:
      "Minea's headline prices are monthly billing; quarterly billing lowers the per-month rate. Confirm current plans on Minea's pricing page.",
    sourceId: "minea-pricing",
  },
] as const;

const fiveToNineAdds = [
  {
    theirs: "A database of winning products",
    ours: "You paste a competitor website. We read the public Meta Ad Library and the live landing page from that domain, then watch them on a schedule — no product hunting first.",
  },
  {
    theirs: "Shop and ad trend tracking",
    ours: "We diff offer, price, CTA, and hook changes, then save the page text, the original source link, and a screenshot when the capture includes one — proof of what actually moved.",
  },
  {
    theirs: "E-commerce focus",
    ours: "Results are marked live, recent, delayed, or sample. We do not present a stale snapshot as a fresh check, whichever vendor you came from.",
  },
] as const;

export const faqEntries: ReadonlyArray<FaqJsonLdEntry> = [
  {
    question: "How much does Minea cost?",
    answer:
      "Minea lists paid Starter, Premium, and Business tiers on monthly billing, with lower per-month rates when paid quarterly. The visible copy on this page cites the figures checked on 2026-09-12. Confirm current plans on Minea's pricing page.",
  },
  {
    question: "Is Five to Nine a Minea alternative?",
    answer:
      "Minea is an ad-spy and shop-research tool for e-commerce product discovery. Five to Nine is scheduled, source-backed Meta Ad Library and landing-page change monitoring that starts from a domain paste — an alternative when the job is the before-and-after record rather than product research.",
  },
  {
    question: "What does Five to Nine add?",
    answer:
      "Paid plans check watched competitors every 3–6 hours, diff offer, price, CTA, and hook fields, and save page text, the original source link, and a screenshot when the capture includes one. Status is labeled live, recent, delayed, or sample.",
  },
] as const;

export default function CompareMineaRoute() {
  const structuredFaq = faqPageJsonLd(faqEntries);

  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: pageTitle,
            description: pageDescription,
            pathname: "/compare/minea",
            comparedProductName: "Minea",
          }),
        )}
      />
      <script {...jsonLdScriptProps(structuredFaq)} />
      <MarketingNav />
      <Breadcrumbs
        items={[
          { name: "Home", pathname: "/" },
          { name: "Competitor monitoring", pathname: "/competitor-monitoring" },
          { name: "Minea", pathname: "/compare/minea" },
        ]}
      />

      <section className="ld-hero">
        <p className="ld-case">
          <span>{pageTitle}</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          Minea finds winning products. Five to Nine proves what changed.
        </h1>
        <p className="ld-deck-copy">
          Minea is an ad-spy tool for e-commerce and dropshipping product research, with monthly
          plans at Starter $49, Premium $99, and Business $199. Five to Nine does the narrower
          Meta Ad Library plus landing-page job, with source-backed proof. Competitor prices on
          this page are from Minea's own pricing page as of September 2026 — check the vendor's
          site for current plans.
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
          <h2>What Minea does well.</h2>
        </div>
        <div className="ld-quiet-grid">
          {mineaStrengths.map((item) => (
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
          {mineaCosts.map((item) => (
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
          needed. Also see <Link to="/compare/bigspy">Five to Nine vs BigSpy</Link> and{" "}
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
