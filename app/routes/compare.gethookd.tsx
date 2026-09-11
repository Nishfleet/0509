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
  buyerSurfaceHreflangLinks,
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
import gethookdCitations from "~/data/compare/gethookd-citations.json";

const citations = gethookdCitations as CompareCitations;

const pageTitle = "Five to Nine vs GetHookd";
const pageDescription =
  "GetHookd is a Facebook Ads Library analysis platform with a 7-day free trial and API & MCP on annual plans. Five to Nine is scheduled, source-backed Meta Ad Library and landing-page change proof.";

export const links: LinksFunction = () => [
  ...canonicalLinks("/compare/gethookd"),
  ...buyerSurfaceHreflangLinks("compare/gethookd"),
];

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: pageTitle,
    description: pageDescription,
    pathname: "/compare/gethookd",
    ogImageUrl: compareSocialCardUrl("gethookd"),
    ogImageAlt: "Five to Nine vs GetHookd comparison card",
  });

const gethookdStrengths: readonly CompareClaimCard[] = [
  {
    title: "An ads-library workbench",
    detail:
      "GetHookd positions itself as a Facebook Ads Library analysis platform for brands, campaigns, and creatives. If the job is organizing and studying what competitors run, that is its core job.",
    sourceId: "gethookd-site",
  },
  {
    title: "A free trial to evaluate it",
    detail:
      "GetHookd's site advertises a 7-day free trial, so you can test the workbench without paying first. Confirm the current terms on GetHookd's site.",
    sourceId: "gethookd-site",
  },
  {
    title: "API and MCP access on annual plans",
    detail:
      "GetHookd includes API and MCP access with every annual plan, so its data can feed your own automation — a capability many older ad-spy tools still lack.",
    sourceId: "gethookd-site",
  },
];

const gethookdCosts: readonly CompareClaimCard[] = [
  {
    title: "A workbench, not a watchtower",
    detail:
      "GetHookd's described job is analyzing the ads you go find. Five to Nine's job is the schedule: check the competitor's ads and landing pages every 3–6 hours and surface what actually moved.",
  },
  {
    title: "Analysis over change proof",
    detail:
      "GetHookd's public materials do not claim diff-and-save change proof. Five to Nine diffs offer, price, CTA, and hook fields and saves the page text, the original source link, and a screenshot when the capture includes one.",
  },
  {
    title: "Trial terms that change",
    detail:
      "Trial lengths, plan entitlements, and where API and MCP sit move as vendors evolve their pricing. Whatever plan you pick, confirm the current terms on the vendor's site before deciding.",
    sourceId: "gethookd-site",
  },
];

const fiveToNineAdds = [
  {
    theirs: "A library you browse",
    ours: "You paste a competitor website. We read the public Meta Ad Library and the live landing page from that domain on a schedule, so you hear when an offer, price, or CTA actually moved — not a feed you have to keep scrolling.",
  },
  {
    theirs: "Analysis without the before-and-after",
    ours: "Confirmed changes are saved with the page text, the original source link, and a screenshot when the capture includes one, so the claim survives a closed tab.",
  },
  {
    theirs: "MCP on annual plans",
    ours: "Five to Nine's customer API and MCP exist on Agency, with honest status labels — live, recent, delayed, or sample — on every result. We do not present a stale snapshot as a fresh check.",
  },
] as const;

export const faqEntries: ReadonlyArray<FaqJsonLdEntry> = [
  {
    question: "Does GetHookd have a free plan?",
    answer:
      "GetHookd's site advertises a 7-day free trial as of September 2026, with API and MCP access included with every annual plan. Confirm current terms on GetHookd's site. The visible copy on this page cites GetHookd's own site.",
  },
  {
    question: "Is Five to Nine a GetHookd alternative?",
    answer:
      "GetHookd is a Facebook Ads Library analysis workbench. Five to Nine is scheduled, source-backed Meta Ad Library and landing-page change monitoring that starts from a domain paste. It is an alternative if you need the before-and-after proof rather than a creative workbench.",
  },
  {
    question: "What does Five to Nine add?",
    answer:
      "Paid plans check watched competitors every 3–6 hours, diff offer, price, CTA, and hook fields, and save page text, the original source link, and a screenshot when the capture includes one. Status is labeled live, recent, delayed, or sample.",
  },
] as const;

export default function CompareGethookdRoute() {
  const structuredFaq = faqPageJsonLd(faqEntries);

  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: pageTitle,
            description: pageDescription,
            pathname: "/compare/gethookd",
            comparedProductName: "GetHookd",
          }),
        )}
      />
      <script {...jsonLdScriptProps(structuredFaq)} />
      <MarketingNav />
      <Breadcrumbs
        items={[
          { name: "Home", pathname: "/" },
          { name: "Competitor monitoring", pathname: "/competitor-monitoring" },
          { name: "GetHookd", pathname: "/compare/gethookd" },
        ]}
      />

      <section className="ld-hero">
        <p className="ld-case">
          <span>{pageTitle}</span>
        </p>
        <h1 className="ld-wall ld-wall-compact">
          GetHookd is an ads-library workbench. Five to Nine is change proof with a source link.
        </h1>
        <p className="ld-deck-copy">
          GetHookd analyzes brands, campaigns, and creatives from the Facebook Ads Library, with a
          7-day free trial and API and MCP access on annual plans. It is a strong workbench. Five to
          Nine is for the scheduled before and after, with source-linked proof of what changed.
          Competitor terms on this page are from GetHookd's own site as of September 2026 — check
          the vendor's site for current plans.
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
          <h2>What GetHookd does well.</h2>
        </div>
        <div className="ld-quiet-grid">
          {gethookdStrengths.map((item) => (
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
          <h2>Where a workbench differs from proof.</h2>
        </div>
        <div className="ld-quiet-grid">
          {gethookdCosts.map((item) => (
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
          <Link to="/compare/foreplay-spyder">Five to Nine vs Foreplay Spyder</Link>. Questions?
          Email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>.
        </p>
      </section>

      <LiveBrandProof domain={LIVE_BRAND_PROOF_DOMAIN} />

      <CompareCitationsFooter citations={citations} />

      <MarketingFooter />
    </main>
  );
}
