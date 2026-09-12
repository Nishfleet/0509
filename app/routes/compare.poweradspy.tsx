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
import poweradspyCitations from "~/data/compare/poweradspy-citations.json";

// Source verification (issue #3092): primary-source-verified —
// https://poweradspy.com/ and https://poweradspy.com/pricing return HTTP 200
// and name real tiers (Standard $99 / Platinum $279 / Palladium $399 monthly,
// 3-day paid trials) — verified live 2026-09-12.
const citations = poweradspyCitations as CompareCitations;

const pageTitle = "Five to Nine vs PowerAdSpy";
const pageDescription =
  "PowerAdSpy is an AI-powered competitive ad intelligence platform across 11 ad networks. Five to Nine is scheduled, source-backed Meta Ad Library and landing-page change proof.";

export const links: LinksFunction = () => canonicalLinks("/compare/poweradspy");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: pageTitle,
    description: pageDescription,
    pathname: "/compare/poweradspy",
    ogImageUrl: compareSocialCardUrl("poweradspy"),
    ogImageAlt: "Five to Nine vs PowerAdSpy comparison card",
  });

const poweradspyStrengths: readonly CompareClaimCard[] = [
  {
    title: "Eleven networks, one search",
    detail:
      "PowerAdSpy indexes ads across 11 networks — Facebook, Instagram, YouTube, Google, TikTok, Reddit, Quora, Pinterest, LinkedIn and more — across 100+ countries.",
    sourceId: "poweradspy-home",
  },
  {
    title: "AI-assisted analysis",
    detail:
      "PowerAdSpy positions itself as an AI-powered competitive ad intelligence platform — search an ad, decode the funnel, reverse-engineer the creative.",
    sourceId: "poweradspy-home",
  },
  {
    title: "Trial before you pay",
    detail:
      "PowerAdSpy sells 3-day trials — $1 on Basic, $7 on Standard, Platinum, and Palladium — so you can test the database before a monthly plan.",
    sourceId: "poweradspy-pricing",
  },
] as const;

const poweradspyCosts: readonly CompareClaimCard[] = [
  {
    title: "An intelligence snapshot, not a change record",
    detail:
      "PowerAdSpy's published scope is finding and analyzing ads across networks. It does not advertise the scheduled before-and-after diff — what changed on a competitor's ads and landing pages, saved as proof — that Five to Nine is built around.",
    sourceId: "poweradspy-home",
  },
  {
    title: "Higher tiers scale fast",
    detail:
      "PowerAdSpy's monthly plans run Standard at $99, Platinum at $279, and Palladium at $399 — network coverage, not depth on one competitor, is what each step buys.",
    sourceId: "poweradspy-pricing",
  },
  {
    title: "Trials roll into monthly rates",
    detail:
      "PowerAdSpy's own pricing notes that after the 3-day trial the plan rolls into its regular monthly rate unless you cancel first — read the billing terms before starting one.",
    sourceId: "poweradspy-pricing",
  },
] as const;

const fiveToNineAdds = [
  {
    theirs: "An eleven-network ad index",
    ours: "You paste a competitor website. We read the public Meta Ad Library and the live landing page from that domain, then watch them on a schedule — no network hunting first.",
  },
  {
    theirs: "AI-assisted ad analysis",
    ours: "We diff offer, price, CTA, and hook changes, then save the page text, the original source link, and a screenshot when the capture includes one — proof of what actually moved.",
  },
  {
    theirs: "A paid 3-day trial",
    ours: "Results are marked live, recent, delayed, or sample. We do not present a stale snapshot as a fresh check, whichever vendor you came from.",
  },
] as const;

export const faqEntries: ReadonlyArray<FaqJsonLdEntry> = [
  {
    question: "How much does PowerAdSpy cost?",
    answer:
      "PowerAdSpy lists Standard at $99/month, Platinum at $279/month, and Palladium at $399/month on monthly billing, with 3-day trials at $1 or $7 and roughly 50–70% off on yearly billing. Confirm current plans on PowerAdSpy's pricing page.",
  },
  {
    question: "Is Five to Nine a PowerAdSpy alternative?",
    answer:
      "PowerAdSpy is a multi-network ad intelligence database for finding and analyzing ads. Five to Nine is scheduled, source-backed Meta Ad Library and landing-page change monitoring that starts from a domain paste — an alternative when the job is the before-and-after record rather than network-wide search.",
  },
  {
    question: "What does Five to Nine add?",
    answer:
      "Paid plans check watched competitors every 3–6 hours, diff offer, price, CTA, and hook fields, and save page text, the original source link, and a screenshot when the capture includes one. Status is labeled live, recent, delayed, or sample.",
  },
] as const;

export default function ComparePoweradspyRoute() {
  const structuredFaq = faqPageJsonLd(faqEntries);

  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: pageTitle,
            description: pageDescription,
            pathname: "/compare/poweradspy",
            comparedProductName: "PowerAdSpy",
          }),
        )}
      />
      <script {...jsonLdScriptProps(structuredFaq)} />
      <MarketingNav />
      <Breadcrumbs
        items={[
          { name: "Home", pathname: "/" },
          { name: "Competitor monitoring", pathname: "/competitor-monitoring" },
          { name: "PowerAdSpy", pathname: "/compare/poweradspy" },
        ]}
      />

      <section className="ld-hero">
        <p className="ld-case">
          <span>{pageTitle}</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          PowerAdSpy indexes eleven networks. Five to Nine proves what changed.
        </h1>
        <p className="ld-deck-copy">
          PowerAdSpy is an AI-powered ad intelligence platform indexing 11 networks across 100+
          countries, with monthly plans at Standard $99, Platinum $279, and Palladium $399 and
          3-day paid trials. Five to Nine does the narrower Meta Ad Library plus landing-page job,
          with source-backed proof. Competitor prices on this page are from PowerAdSpy's own
          pricing page as of September 2026 — check the vendor's site for current plans.
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
          <h2>What PowerAdSpy does well.</h2>
        </div>
        <div className="ld-quiet-grid">
          {poweradspyStrengths.map((item) => (
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
          {poweradspyCosts.map((item) => (
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
          needed. Also see <Link to="/compare/minea">Five to Nine vs Minea</Link> and{" "}
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
